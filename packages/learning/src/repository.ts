import { z } from 'zod';
import {
  type AttemptInput,
  applyAttempt,
  emptyMastery,
  MASTERED_BOX,
  type MasteryState,
  type WordStats,
} from './mastery';

/** Matches both `window.localStorage` and React Native AsyncStorage. */
export interface KeyValueStore {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

export const learnerProfileSchema = z.object({
  name: z.string().max(60).default(''),
  /** Used by games for theming: "minecraft", "soccer", "dinosaurs"... */
  interests: z.array(z.string().max(40)).max(20).default([]),
  /** Show games whose manifest status is "draft" in the launcher. */
  showDrafts: z.boolean().default(false),
});

export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

export const sessionRecordSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  gameVersion: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  score: z.number().optional(),
});

export type SessionRecord = z.infer<typeof sessionRecordSchema>;

const wordStatsSchema = z.object({
  box: z.number().int().min(0).max(MASTERED_BOX),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  lastResult: z.enum(['correct', 'incorrect']),
  lastSeenAt: z.number(),
  dueAt: z.number(),
  lastResponse: z.string().optional(),
});

/** Invalid word entries are dropped individually so one bad record doesn't reset all progress. */
const masteryStateSchema = z.object({
  version: z.literal(1),
  words: z.record(z.string(), z.unknown()).transform((words) => {
    const valid: Record<string, WordStats> = {};
    for (const [key, value] of Object.entries(words)) {
      const parsed = wordStatsSchema.safeParse(value);
      if (parsed.success) valid[key] = parsed.data;
    }
    return valid;
  }),
});

const MAX_SESSIONS = 500;

export interface LearnerRepository {
  getProfile(): Promise<LearnerProfile>;
  saveProfile(profile: Partial<LearnerProfile>): Promise<LearnerProfile>;
  getMastery(): Promise<MasteryState>;
  recordAttempts(attempts: readonly AttemptInput[], now?: number): Promise<MasteryState>;
  getSessions(): Promise<SessionRecord[]>;
  recordSession(session: SessionRecord): Promise<void>;
  /** Free-form save data scoped to one game (high scores, unlocked levels...). */
  gameData(gameId: string): {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
}

/**
 * All learner state lives behind a key-value store so every platform (browser
 * localStorage, AsyncStorage, a future sync backend) shares this logic.
 * Corrupt or outdated data falls back to defaults instead of crashing a game.
 */
export function createLearnerRepository(
  store: KeyValueStore,
  { prefix = 'braincade:' }: { prefix?: string } = {},
): LearnerRepository {
  const k = (name: string) => `${prefix}${name}`;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function read<T>(name: string, schema: z.ZodType<T>, fallback: () => T): Promise<T> {
    const raw = await store.getItem(k(name));
    if (raw == null) return fallback();
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : fallback();
    } catch {
      return fallback();
    }
  }

  const write = async (name: string, value: unknown) => {
    await store.setItem(k(name), JSON.stringify(value));
  };

  const defaultProfile = () => learnerProfileSchema.parse({});

  return {
    getProfile: () => read('profile', learnerProfileSchema, defaultProfile),
    saveProfile: (patch) =>
      serialize(async () => {
        const current = await read('profile', learnerProfileSchema, defaultProfile);
        const next = learnerProfileSchema.parse({ ...current, ...patch });
        await write('profile', next);
        return next;
      }),
    getMastery: () => read('mastery', masteryStateSchema, emptyMastery),
    recordAttempts: (attempts, now = Date.now()) =>
      serialize(async () => {
        let state = await read('mastery', masteryStateSchema, emptyMastery);
        for (const attempt of attempts) state = applyAttempt(state, attempt, now);
        await write('mastery', state);
        return state;
      }),
    getSessions: () => read('sessions', z.array(sessionRecordSchema), () => []),
    recordSession: (session) =>
      serialize(async () => {
        const sessions = await read('sessions', z.array(sessionRecordSchema), () => []);
        sessions.push(sessionRecordSchema.parse(session));
        await write('sessions', sessions.slice(-MAX_SESSIONS));
      }),
    gameData: (gameId) => ({
      get: async (key) => {
        const raw = await store.getItem(k(`game:${gameId}:${key}`));
        if (raw == null) return undefined;
        try {
          return JSON.parse(raw);
        } catch {
          return undefined;
        }
      },
      set: (key, value) => serialize(() => write(`game:${gameId}:${key}`, value)),
    }),
  };
}
