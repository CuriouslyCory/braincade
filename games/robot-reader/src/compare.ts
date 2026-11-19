/**
 * Compares what the learner was asked to copy with what the handwriting reader
 * saw. Pure functions, no React, so the scoring rules are easy to test.
 */

/** One word as the reader saw it. `text` is a best guess when `legible` is false. */
export interface ReadWord {
  text: string;
  legible: boolean;
}

export type WordStatus = 'correct' | 'misspelled' | 'missing' | 'unreadable';

/** How one word of the target sentence came out. */
export interface ExpectedResult {
  /** Position in the sentence's words. */
  index: number;
  /** The word as it appears in the sentence (punctuation included). */
  expected: string;
  status: WordStatus;
  /** The reader's word aligned with this one (absent when `missing`). */
  read?: string;
  /** Index into the flattened reading (absent when `missing`). */
  readIndex?: number;
}

/** A word in the reading that has no partner in the sentence. */
export interface ExtraResult {
  read: string;
  readIndex: number;
  legible: boolean;
  /** Index of the sentence word it comes after (-1 = before the first word). */
  after: number;
}

export type AlignedItem =
  | ({ kind: 'expected' } & ExpectedResult)
  | ({ kind: 'extra' } & ExtraResult);

export interface Comparison {
  /** One entry per sentence word, in order. */
  words: ExpectedResult[];
  extras: ExtraResult[];
  /** Sentence words and extras interleaved in reading order, for display. */
  aligned: AlignedItem[];
  counts: Record<WordStatus | 'extra', number> & { total: number };
}

const APOSTROPHES = /[‘’ʼ`´]/g;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Lowercase, curly apostrophes made straight, surrounding punctuation removed.
 * Internal apostrophes stay, so "its" and "it's" are different words.
 */
export function normalizeWord(word: string): string {
  return word.replace(APOSTROPHES, "'").replace(EDGE_PUNCTUATION, '').toLowerCase();
}

/** Split a token into leading punctuation, the word, and trailing punctuation. */
export function splitToken(token: string): [lead: string, core: string, trail: string] {
  const match = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(token);
  return [match?.[1] ?? '', match?.[2] ?? token, match?.[3] ?? ''];
}

/** The words of a sentence as written (punctuation attached), skipping lone punctuation. */
export function sentenceWords(sentence: string): string[] {
  return sentence.split(/\s+/).filter((token) => normalizeWord(token) !== '');
}

/** Index of the target word in the sentence's words, or -1. */
export function findWordIndex(words: readonly string[], target: string): number {
  const wanted = normalizeWord(target);
  const exact = words.findIndex((w) => normalizeWord(w) === wanted);
  return exact >= 0 ? exact : words.findIndex((w) => normalizeWord(w).includes(wanted));
}

/**
 * The reading as one word per entry: multi-word entries are split, and legible
 * entries that are only punctuation are dropped. Unreadable entries always stay,
 * even when their guess is empty, because they stand for a written word.
 */
export function flattenReading(words: readonly ReadWord[]): ReadWord[] {
  const out: ReadWord[] = [];
  for (const word of words) {
    const parts = word.text.trim().split(/\s+/).filter(Boolean);
    if (!word.legible) {
      if (parts.length === 0) out.push({ text: '', legible: false });
      for (const text of parts) out.push({ text, legible: false });
      continue;
    }
    for (const text of parts) {
      if (normalizeWord(text) !== '') out.push({ text, legible: true });
    }
  }
  return out;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** 0 = same letters, 1 = nothing in common. */
function letterDistance(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : editDistance(a, b) / longest;
}

// Skipping a word (missing or extra) costs 1. Pairing two different words costs
// between 1 and 1.9 depending on how alike they look: always cheaper than a skip
// on both sides, so a wrong word in the right spot counts as misspelled, but
// similar words pair up first when a neighbouring word went missing.
const SKIP = 1;
const UNREADABLE_PAIR = 1.5;
const EPSILON = 1e-9;

function pairCost(expected: string, read: ReadWord): number {
  const seen = normalizeWord(read.text);
  if (read.legible) return seen === expected ? 0 : 1 + 0.9 * letterDistance(expected, seen);
  return seen ? 1 + 0.9 * letterDistance(expected, seen) : UNREADABLE_PAIR;
}

/** Align the sentence against the reading (edit-distance alignment) and score each word. */
export function compareWords(sentence: string, reading: readonly ReadWord[]): Comparison {
  const expected = sentenceWords(sentence);
  const target = expected.map(normalizeWord);
  const read = flattenReading(reading);
  const n = expected.length;
  const m = read.length;

  // cost[i][j] = cheapest alignment of the first i sentence words with the first j read words.
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => cost[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= n; i++) {
    const row = cost[i] as number[];
    for (let j = 1; j <= m; j++) {
      row[j] = Math.min(
        at(i - 1, j - 1) + pairCost(target[i - 1] ?? '', read[j - 1] as ReadWord),
        at(i - 1, j) + SKIP,
        at(i, j - 1) + SKIP,
      );
    }
  }

  // Walk back from the end, preferring pairs, then missing words, then extras.
  const aligned: AlignedItem[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = at(i, j);
    const word = read[j - 1];
    if (
      i > 0 &&
      j > 0 &&
      word &&
      Math.abs(here - (at(i - 1, j - 1) + pairCost(target[i - 1] ?? '', word))) < EPSILON
    ) {
      const status: WordStatus = !word.legible
        ? 'unreadable'
        : normalizeWord(word.text) === target[i - 1]
          ? 'correct'
          : 'misspelled';
      aligned.push({
        kind: 'expected',
        index: i - 1,
        expected: expected[i - 1] ?? '',
        status,
        read: word.text,
        readIndex: j - 1,
      });
      i--;
      j--;
    } else if (i > 0 && Math.abs(here - (at(i - 1, j) + SKIP)) < EPSILON) {
      aligned.push({
        kind: 'expected',
        index: i - 1,
        expected: expected[i - 1] ?? '',
        status: 'missing',
      });
      i--;
    } else if (word) {
      aligned.push({
        kind: 'extra',
        read: word.text,
        readIndex: j - 1,
        legible: word.legible,
        after: i - 1,
      });
      j--;
    } else {
      break;
    }
  }
  aligned.reverse();

  const words: ExpectedResult[] = [];
  const extras: ExtraResult[] = [];
  const counts = { correct: 0, misspelled: 0, missing: 0, unreadable: 0, extra: 0, total: n };
  for (const item of aligned) {
    const { kind, ...rest } = item;
    if (kind === 'extra') {
      extras.push(rest as ExtraResult);
      counts.extra++;
    } else {
      const result = rest as ExpectedResult;
      words.push(result);
      counts[result.status]++;
    }
  }
  return { words, extras, aligned, counts };
}
