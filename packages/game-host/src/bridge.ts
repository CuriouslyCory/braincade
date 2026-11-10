import {
  type Capability,
  CHANNEL,
  type ErrorCode,
  frameMessageSchema,
  type GameManifest,
  HostError,
  isMethodName,
  type MethodName,
  type MethodResults,
  methodParamSchemas,
  type ParsedMethodParams,
  type Platform,
  PROTOCOL_VERSION,
  type RequestMessage,
  type SessionInfo,
  type Transport,
} from '@braincade/game-sdk';
import { type LearnerRepository, poolWords, selectWords, type WordList } from '@braincade/learning';
import type { PrintableDocument } from '@braincade/printables';

export interface SpeechCapability {
  speak(text: string, options: { rate?: number; language?: string }): Promise<void>;
  stop(): void | Promise<void>;
}

export interface PrintCapability {
  print(document: PrintableDocument): Promise<void>;
}

/** What each platform (web, mobile) provides to run games. */
export interface HostPlatform {
  platform: Platform;
  locale: string;
  learner: LearnerRepository;
  wordLists: readonly WordList[];
  speech?: SpeechCapability;
  printer?: PrintCapability;
  now?: () => number;
  random?: () => number;
  newId?: () => string;
}

export function platformCapabilities(
  platform: Pick<HostPlatform, 'speech' | 'printer'>,
): Capability[] {
  const caps: Capability[] = ['storage'];
  if (platform.speech) caps.push('speech');
  if (platform.printer) caps.push('print');
  return caps;
}

export interface HostBridgeOptions extends HostPlatform {
  transport: Transport;
  game: GameManifest;
  onReady?: () => void;
  onError?: (error: { code?: string; message: string }) => void;
  /** The game asked to end (ctx.exit). The host should close the frame. */
  onGameExit?: () => void;
}

export interface HostBridge {
  /** Ask the game to clean up, wait for it (bounded), then record the session. */
  requestExit(options?: { timeoutMs?: number }): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stop listening. Records the session if it was not already recorded. */
  dispose(): void;
}

// Hermes (React Native) has no crypto.randomUUID, so fall back to a timestamp id.
const defaultId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type Handler<M extends MethodName> = (params: ParsedMethodParams<M>) => Promise<MethodResults[M]>;

/**
 * Host side of the game protocol: validates every request from the frame,
 * dispatches it to the platform's capabilities and the learner repository, and
 * keeps session bookkeeping (attempts, score, duration) on the host so it is
 * recorded even if a game never calls exit().
 */
export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const { transport, game, learner, speech, printer } = options;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? defaultId;
  const capabilities = platformCapabilities(options);

  const session = {
    id: '',
    startedAt: 0,
    attempts: 0,
    correct: 0,
    score: undefined as number | undefined,
    recorded: false,
  };
  let exitedResolve: (() => void) | null = null;

  const send = (message: object) =>
    transport.send({ channel: CHANNEL, v: PROTOCOL_VERSION, ...message });

  async function recordSession() {
    if (!session.id || session.recorded) return;
    session.recorded = true;
    try {
      await learner.recordSession({
        id: session.id,
        gameId: game.id,
        gameVersion: game.version,
        startedAt: session.startedAt,
        endedAt: now(),
        attempts: session.attempts,
        correct: session.correct,
        ...(session.score === undefined ? {} : { score: session.score }),
      });
    } catch (error) {
      // A failed write (storage full, AsyncStorage error) must never block exiting the game.
      // Allow a later call (e.g. dispose) to retry.
      session.recorded = false;
      options.onError?.({
        code: 'storage',
        message: `Could not save the session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const unsupported = (capability: Capability) =>
    new HostError('unsupported', `This device does not support ${capability}.`);

  const handlers: { [M in MethodName]: Handler<M> } = {
    'session.start': async ({ gameId }) => {
      if (gameId !== game.id) {
        throw new HostError('not-found', `Host is running "${game.id}", not "${gameId}".`);
      }
      const profile = await learner.getProfile();
      session.id = newId();
      session.startedAt = now();
      const info: SessionInfo = {
        sessionId: session.id,
        gameId: game.id,
        platform: options.platform,
        capabilities,
        learner: { name: profile.name, interests: profile.interests },
        locale: options.locale,
      };
      return info;
    },
    'words.next': async ({ count, tags, includeMastered }) => {
      const mastery = await learner.getMastery();
      const picked = selectWords(poolWords(options.wordLists), mastery, {
        count,
        now: now(),
        ...(tags ? { tags } : {}),
        ...(includeMastered === undefined ? {} : { includeMastered }),
        ...(options.random ? { random: options.random } : {}),
      });
      return picked.map(({ key: _key, ...word }) => word);
    },
    'progress.record': async ({ attempts }) => {
      await learner.recordAttempts(attempts, now());
      session.attempts += attempts.length;
      session.correct += attempts.filter((a) => a.correct).length;
      return null;
    },
    'speech.speak': async ({ text, rate, language }) => {
      if (!speech) throw unsupported('speech');
      await speech.speak(text, {
        ...(rate === undefined ? {} : { rate }),
        language: language ?? options.locale,
      });
      return null;
    },
    'speech.stop': async () => {
      await speech?.stop();
      return null;
    },
    'print.document': async ({ document }) => {
      if (!printer) throw unsupported('print');
      await printer.print(document);
      return null;
    },
    'storage.get': async ({ key }) => (await learner.gameData(game.id).get(key)) ?? null,
    'storage.set': async ({ key, value }) => {
      await learner.gameData(game.id).set(key, value);
      return null;
    },
    'session.end': async ({ score }) => {
      if (score !== undefined) session.score = score;
      await recordSession();
      queueMicrotask(() => options.onGameExit?.());
      return null;
    },
  };

  async function handleRequest(message: RequestMessage) {
    const respondError = (code: ErrorCode, errorMessage: string) =>
      send({ type: 'response', id: message.id, ok: false, error: { code, message: errorMessage } });

    if (!isMethodName(message.method)) {
      respondError('unknown-method', `Unknown method "${message.method}"`);
      return;
    }
    const method = message.method;
    const parsed = methodParamSchemas[method].safeParse(message.params ?? {});
    if (!parsed.success) {
      respondError('bad-request', `Invalid params for ${method}: ${parsed.error.message}`);
      return;
    }
    try {
      const handler = handlers[method] as Handler<MethodName>;
      const result = await handler(parsed.data as ParsedMethodParams<MethodName>);
      send({ type: 'response', id: message.id, ok: true, result });
    } catch (error) {
      if (error instanceof HostError) respondError(error.code, error.message);
      else respondError('internal', error instanceof Error ? error.message : String(error));
    }
  }

  const stop = transport.listen((raw) => {
    const parsed = frameMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'request') {
      void handleRequest(message);
      return;
    }
    if (message.name === 'ready') options.onReady?.();
    else if (message.name === 'exited') exitedResolve?.();
    else if (message.name === 'error') {
      const data = (message.data ?? {}) as { code?: string; message?: string };
      options.onError?.({
        ...(data.code ? { code: data.code } : {}),
        message: data.message ?? 'Unknown game error',
      });
    }
  });

  return {
    async requestExit({ timeoutMs = 1500 } = {}) {
      const exited = new Promise<void>((resolve) => {
        exitedResolve = resolve;
        setTimeout(resolve, timeoutMs);
      });
      send({ type: 'event', name: 'exit' });
      await exited;
      await recordSession();
    },
    pause: () => send({ type: 'event', name: 'pause' }),
    resume: () => send({ type: 'event', name: 'resume' }),
    dispose() {
      stop();
      void recordSession();
    },
  };
}
