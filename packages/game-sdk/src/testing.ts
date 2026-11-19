import type { Attempt, AttemptInput } from '@braincade/learning';
import { attemptSchema } from '@braincade/learning';
import { type PrintableDocument, printableDocumentSchema } from '@braincade/printables';
import type { CaptureOptions, GameContext } from './context';
import type { Capability, GameManifest } from './manifest';
import {
  type CapturedImage,
  capturedImageSchema,
  type EndResult,
  type GameWord,
  type HandwritingReading,
  HostError,
  handwritingReadingSchema,
  type SessionInfo,
} from './protocol';

/** A 1×1 PNG, handy as a stand-in photo. */
export const TEST_IMAGE: CapturedImage = {
  image:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  width: 1,
  height: 1,
};

export interface TestContextOptions {
  manifest?: Partial<GameManifest>;
  session?: Partial<SessionInfo>;
  /** Words returned by ctx.words.next(); plain strings become new, untagged words. */
  words?: Array<string | GameWord>;
  /**
   * What ctx.camera.capture() returns, one per call (`null` = the learner cancelled).
   * When the list runs out, TEST_IMAGE is returned.
   */
  photos?: Array<CapturedImage | null>;
  /** What ctx.handwriting.read() returns (default: no words). A string becomes legible words. */
  read?: (image: string) => HandwritingReading | string | Promise<HandwritingReading | string>;
}

export interface TestContext {
  ctx: GameContext;
  spoken: string[];
  printed: PrintableDocument[];
  attempts: Attempt[];
  storage: Map<string, unknown>;
  exited: EndResult | null;
  /** Options passed to each ctx.camera.capture() call. */
  captures: CaptureOptions[];
  /** Image data URLs passed to ctx.handwriting.read(). */
  reads: string[];
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
  const photos = [...(options.photos ?? [])];
  const require = (capability: Capability) => {
    if (!capabilities.includes(capability)) {
      throw new HostError('unsupported', `This device does not support ${capability}.`);
    }
  };
  const listeners = { pause: new Set<() => void>(), resume: new Set<() => void>() };

  const result: TestContext = {
    spoken: [],
    printed: [],
    attempts: [],
    storage: new Map(),
    exited: null,
    captures: [],
    reads: [],
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
      camera: {
        capture: async (captureOptions = {}) => {
          require('camera');
          result.captures.push(captureOptions);
          const photo = photos.length ? photos.shift() : TEST_IMAGE;
          return photo ? capturedImageSchema.parse(photo) : null;
        },
      },
      handwriting: {
        read: async (image) => {
          require('handwriting');
          const dataUrl = typeof image === 'string' ? image : image.image;
          result.reads.push(dataUrl);
          const reading = (await options.read?.(dataUrl)) ?? { words: [] };
          return handwritingReadingSchema.parse(
            typeof reading === 'string'
              ? {
                  words: reading
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((text) => ({ text, legible: true })),
                }
              : reading,
          );
        },
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
