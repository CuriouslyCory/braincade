import type { AttemptInput } from '@braincade/learning';
import type { PrintableDocumentInput } from '@braincade/printables';
import type { HostClient } from './client';
import type { Capability, GameManifest } from './manifest';
import type {
  CapturedImage,
  EndResult,
  GameWord,
  HandwritingReading,
  SessionInfo,
} from './protocol';

export interface WordRequest {
  /** How many words to return (default 10). Fewer come back if the lists run out. */
  count?: number;
  /** Only words tagged with at least one of these, e.g. ["homophone"]. */
  tags?: string[];
  /** Also return mastered words that are not yet due for review. */
  includeMastered?: boolean;
}

export interface SpeakOptions {
  /** 0.25-2, default 1. Slow it down for dictation. */
  rate?: number;
  language?: string;
}

export interface CaptureOptions {
  /** Short instruction shown while the camera is open ("Snap your sentence"). */
  prompt?: string;
  /** Which camera to prefer (default: the back camera). */
  facing?: 'environment' | 'user';
  /** Longest side of the returned image in pixels, 320-2048 (default 1600). */
  maxSize?: number;
}

/** Handwriting recognition can take several seconds on a slow connection. */
export const HANDWRITING_TIMEOUT_MS = 45_000;

/**
 * Everything a game can do. Games get this in `mount` and should not reach for
 * localStorage, speechSynthesis, or window.print directly so they behave the
 * same on web and mobile.
 */
export interface GameContext {
  readonly session: SessionInfo;
  readonly manifest: GameManifest;
  /** Whether the host provides a capability. Check before using optional features. */
  has(capability: Capability): boolean;
  words: {
    /** Words to practice next, chosen by the learner's mastery (due and missed words first). */
    next(request?: WordRequest): Promise<GameWord[]>;
  };
  progress: {
    /** Report answers. This is what drives mastery, rematch sheets, and the parent view. */
    record(attempts: AttemptInput | AttemptInput[]): Promise<void>;
  };
  speech: {
    speak(text: string, options?: SpeakOptions): Promise<void>;
    stop(): Promise<void>;
  };
  /** Send a worksheet to the printer (browser print dialog / system print sheet). */
  print(document: PrintableDocumentInput): Promise<void>;
  /** Take a photo with the host's camera UI (requires the `camera` capability). */
  camera: {
    /** Resolves to `null` if the learner closes the camera without taking a photo. */
    capture(options?: CaptureOptions): Promise<CapturedImage | null>;
  };
  /** Read handwriting in a photo (requires the `handwriting` capability). */
  handwriting: {
    /** Words as written, misspellings kept; unreadable words come back `legible: false`. */
    read(image: CapturedImage | string): Promise<HandwritingReading>;
  };
  /** Save data for this game only (high scores, unlocked levels). Values must be JSON. */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  /** Pause/resume when the app is backgrounded or the tab is hidden. */
  on(event: 'pause' | 'resume', listener: () => void): () => void;
  /** End the session and return to the launcher. */
  exit(result?: EndResult): Promise<void>;
}

/**
 * Speech resolves when the utterance finishes, so allow for its duration
 * (~150 ms per character at rate 1) on top of the normal round trip.
 */
export function speechTimeoutMs(text: string, rate = 1): number {
  return 10_000 + Math.ceil((text.length * 150) / rate);
}

export function createGameContext(
  client: HostClient,
  session: SessionInfo,
  manifest: GameManifest,
): GameContext {
  return {
    session,
    manifest,
    has: (capability) => session.capabilities.includes(capability),
    words: {
      next: (request = {}) => client.request('words.next', request),
    },
    progress: {
      record: async (attempts) => {
        await client.request('progress.record', {
          attempts: Array.isArray(attempts) ? attempts : [attempts],
        });
      },
    },
    speech: {
      speak: async (text, options = {}) => {
        await client.request(
          'speech.speak',
          { text, ...options },
          { timeoutMs: speechTimeoutMs(text, options.rate) },
        );
      },
      stop: async () => {
        await client.request('speech.stop', {});
      },
    },
    print: async (document) => {
      // The print dialog stays open until the user closes it, so never time out.
      await client.request('print.document', { document }, { timeoutMs: null });
    },
    camera: {
      // The camera stays open until the learner snaps or cancels, so never time out.
      capture: (options = {}) => client.request('camera.capture', options, { timeoutMs: null }),
    },
    handwriting: {
      read: (image) =>
        client.request(
          'handwriting.read',
          { image: typeof image === 'string' ? image : image.image },
          { timeoutMs: HANDWRITING_TIMEOUT_MS },
        ),
    },
    storage: {
      get: async <T>(key: string) =>
        (await client.request('storage.get', { key })) as T | undefined,
      set: async (key, value) => {
        await client.request('storage.set', { key, value });
      },
    },
    on: (event, listener) => client.onEvent(event, listener),
    exit: async (result = {}) => {
      await client.request('session.end', result);
    },
  };
}
