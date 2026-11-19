import type { Attempt, AttemptInput } from '@braincade/learning';
import { attemptSchema } from '@braincade/learning';
import { type PrintableDocument, printableDocumentSchema } from '@braincade/printables';
import type { GameContext } from './context';
import type { Capability, GameManifest } from './manifest';
import type { EndResult, GameWord, SessionInfo } from './protocol';

export interface TestContextOptions {
  manifest?: Partial<GameManifest>;
  session?: Partial<SessionInfo>;
  /** Words returned by ctx.words.next(); plain strings become new, untagged words. */
  words?: Array<string | GameWord>;
}

export interface TestContext {
  ctx: GameContext;
  spoken: string[];
  printed: PrintableDocument[];
  attempts: Attempt[];
  storage: Map<string, unknown>;
  exited: EndResult | null;
  /** Fire a lifecycle event as the host would. */
  emit(event: 'pause' | 'resume'): void;
}

/**
 * An in-memory GameContext for unit-testing a game's mount() without a host.
 * Calls are recorded so tests can assert what the game said, printed, and scored.
 */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  const manifest: GameManifest = {
    id: 'test-game',
    title: 'Test Game',
    description: 'A game under test',
    icon: '🧪',
    engine: 'dom',
    skills: ['spelling'],
    requires: [],
    status: 'draft',
    version: '0.0.0',
    ...options.manifest,
  };
  const capabilities: Capability[] = options.session?.capabilities ?? [
    'storage',
    'speech',
    'print',
  ];
  const session: SessionInfo = {
    sessionId: 'test-session',
    gameId: manifest.id,
    platform: 'web',
    learner: { name: 'Tester', interests: [] },
    locale: 'en-US',
    ...options.session,
    capabilities,
  };
  const words: GameWord[] = (options.words ?? ['because', 'friend', 'their']).map((w) =>
    typeof w === 'string' ? { word: w, tags: [], listId: 'test', status: 'new', box: 0 } : w,
  );
  const listeners = { pause: new Set<() => void>(), resume: new Set<() => void>() };

  const result: TestContext = {
    spoken: [],
    printed: [],
    attempts: [],
    storage: new Map(),
    exited: null,
    emit: (event) => {
      for (const listener of listeners[event]) listener();
    },
    ctx: {
      session,
      manifest,
      has: (capability) => capabilities.includes(capability),
      words: {
        next: async ({ count = 10, tags } = {}) =>
          words
            .filter((w) => !tags?.length || w.tags.some((t) => tags.includes(t)))
            .slice(0, count),
      },
      progress: {
        record: async (input: AttemptInput | AttemptInput[]) => {
          const list = Array.isArray(input) ? input : [input];
          result.attempts.push(...list.map((a) => attemptSchema.parse(a)));
        },
      },
      speech: {
        speak: async (text) => {
          result.spoken.push(text);
        },
        stop: async () => {},
      },
      print: async (document) => {
        result.printed.push(printableDocumentSchema.parse(document));
      },
      storage: {
        get: async <T>(key: string) => result.storage.get(key) as T | undefined,
        set: async (key, value) => {
          result.storage.set(key, JSON.parse(JSON.stringify(value)));
        },
      },
      on: (event, listener) => {
        listeners[event].add(listener);
        return () => listeners[event].delete(listener);
      },
      exit: async (end = {}) => {
        result.exited = end;
      },
    },
  };
  return result;
}
