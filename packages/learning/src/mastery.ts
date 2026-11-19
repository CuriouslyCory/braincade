import { z } from 'zod';
import { type PooledWord, wordKey } from './words';

/**
 * Leitner-style spaced repetition. Every word sits in a box:
 *   0 = never attempted, 1 = missed last time (practice now),
 *   2-4 = learning, 5 = mastered (reviewed every couple of weeks).
 * A correct answer moves a word up one box; a miss drops it to box 1.
 */
export const MASTERED_BOX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14] as const;

export const attemptSchema = z.object({
  word: z.string().trim().min(1).max(60),
  correct: z.boolean(),
  /** How the learner produced the answer. Lets a parent see typed vs handwritten accuracy. */
  mode: z.enum(['typed', 'spoken', 'handwritten', 'selected', 'other']).default('other'),
  /** What the learner actually wrote, for spotting error patterns later. */
  response: z.string().max(120).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptInput = z.input<typeof attemptSchema>;

export interface WordStats {
  box: number;
  correct: number;
  incorrect: number;
  lastResult: 'correct' | 'incorrect';
  lastSeenAt: number;
  dueAt: number;
  lastResponse?: string;
}

export interface MasteryState {
  version: 1;
  words: Record<string, WordStats>;
}

export type WordStatus = 'new' | 'learning' | 'mastered';

export function emptyMastery(): MasteryState {
  return { version: 1, words: {} };
}

export function wordStatus(stats: WordStats | undefined): WordStatus {
  if (!stats) return 'new';
  return stats.box >= MASTERED_BOX ? 'mastered' : 'learning';
}

export function applyAttempt(state: MasteryState, input: AttemptInput, now: number): MasteryState {
  const attempt = attemptSchema.parse(input);
  const key = wordKey(attempt.word);
  const prev = state.words[key];
  const box = attempt.correct ? Math.min(Math.max(prev?.box ?? 0, 1) + 1, MASTERED_BOX) : 1;
  const next: WordStats = {
    box,
    correct: (prev?.correct ?? 0) + (attempt.correct ? 1 : 0),
    incorrect: (prev?.incorrect ?? 0) + (attempt.correct ? 0 : 1),
    lastResult: attempt.correct ? 'correct' : 'incorrect',
    lastSeenAt: now,
    dueAt: now + (BOX_INTERVAL_DAYS[box] ?? 0) * DAY_MS,
  };
  if (attempt.response !== undefined) next.lastResponse = attempt.response;
  return { ...state, words: { ...state.words, [key]: next } };
}

export interface SelectOptions {
  count: number;
  /** Only words carrying at least one of these tags. */
  tags?: readonly string[];
  /** Include mastered words that are not yet due for review. */
  includeMastered?: boolean;
  now: number;
  random?: () => number;
}

export interface SelectedWord extends PooledWord {
  status: WordStatus;
  box: number;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Pick the next words to practice: due words first (lowest box, then oldest),
 * then new words, then words that are not due yet. Mastered words only show up
 * when due unless `includeMastered` is set.
 */
export function selectWords(
  pool: readonly PooledWord[],
  state: MasteryState,
  options: SelectOptions,
): SelectedWord[] {
  const { count, tags, now, includeMastered = false, random = Math.random } = options;
  const candidates = tags?.length ? pool.filter((w) => w.tags.some((t) => tags.includes(t))) : pool;

  const due: SelectedWord[] = [];
  const fresh: SelectedWord[] = [];
  const later: SelectedWord[] = [];
  for (const word of candidates) {
    const stats = state.words[word.key];
    const selected: SelectedWord = { ...word, status: wordStatus(stats), box: stats?.box ?? 0 };
    if (!stats) fresh.push(selected);
    else if (stats.dueAt <= now) due.push(selected);
    else if (stats.box < MASTERED_BOX || includeMastered) later.push(selected);
  }

  const lastSeen = (w: SelectedWord) => state.words[w.key]?.lastSeenAt ?? 0;
  const dueAt = (w: SelectedWord) => state.words[w.key]?.dueAt ?? 0;
  due.sort((a, b) => a.box - b.box || lastSeen(a) - lastSeen(b));
  later.sort((a, b) => dueAt(a) - dueAt(b));

  return [...due, ...shuffle(fresh, random), ...later].slice(0, Math.max(0, count));
}

/** Words missed since a point in time: the source for "rematch" sheets. */
export function missedWords(state: MasteryState, since: number): string[] {
  return Object.entries(state.words)
    .filter(([, s]) => s.lastResult === 'incorrect' && s.lastSeenAt >= since)
    .sort(([, a], [, b]) => b.lastSeenAt - a.lastSeenAt)
    .map(([key]) => key);
}

export interface MasterySummary {
  total: number;
  new: number;
  learning: number;
  mastered: number;
}

export function summarizeMastery(pool: readonly PooledWord[], state: MasteryState): MasterySummary {
  const summary: MasterySummary = { total: pool.length, new: 0, learning: 0, mastered: 0 };
  for (const word of pool) summary[wordStatus(state.words[word.key])]++;
  return summary;
}
