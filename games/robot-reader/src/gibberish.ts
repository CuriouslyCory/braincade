/**
 * Silly nonsense words the robot "reads" when it can't make out a word.
 * Deterministic: the same seed always gives the same word, so a re-render or a
 * test sees the same gibberish.
 */

// Syllables end in a consonant and endings start with a vowel, so any
// combination stays sayable: "zib" + "a" + "flom" + "oodle".
const SHORT = [
  'zib',
  'wum',
  'dib',
  'yop',
  'zor',
  'mib',
  'zub',
  'jub',
  'tuz',
  'fip',
  'gub',
  'zep',
  'bim',
  'kro',
  'wob',
] as const;
const SYLLABLES = [
  'blorp',
  'snorf',
  'flom',
  'wib',
  'gloop',
  'plink',
  'quib',
  'fizz',
  'bonk',
  'krup',
  'glim',
  'frum',
  'skwob',
  'grob',
  'flib',
  'zang',
  'splud',
] as const;
const LINKS = ['a', 'o', 'i', 'u'] as const;
const ENDS = [
  'oodle',
  'ix',
  'orp',
  'izzle',
  'umph',
  'ozzle',
  'ung',
  'ax',
  'erf',
  'onk',
  'itz',
  'ibble',
  'ump',
  'o',
  'a',
] as const;

/** Never produce these, even inside a longer word. */
const BLOCKED_PARTS = [
  'ass',
  'butt',
  'poo',
  'pee',
  'piss',
  'fart',
  'damn',
  'hell',
  'crap',
  'sex',
  'dick',
  'fuc',
  'fuk',
  'shit',
  'tit',
  'cum',
  'nig',
  'fag',
  'kill',
  'dumb',
  'hate',
  'gay',
  'cock',
  'dong',
  'boob',
  'nazi',
] as const;

/** Real words the syllables can happen to spell; gibberish should never look like a real word. */
const REAL_WORDS = new Set([
  'bimbo',
  'gubba',
  'kroa',
  'kroo',
  'plinko',
  'zippo',
  'zoro',
  'dibble',
  'zubu',
  'yopa',
  'jubo',
  'wobbly',
  'fizza',
  'bonko',
  'gloopy',
  'groba',
  'krupa',
]);

const MIN_LENGTH = 3;
const MAX_LENGTH = 14;

function hash(text: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random generator returning [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** Whether a word is safe to show: no blocked fragments, not a known real word. */
export function isAllowedGibberish(word: string, avoid: ReadonlySet<string> = new Set()): boolean {
  const lower = word.toLowerCase();
  return (
    !REAL_WORDS.has(lower) && !avoid.has(lower) && !BLOCKED_PARTS.some((p) => lower.includes(p))
  );
}

export interface GibberishOptions {
  /** Which sentence this is (keeps sentences from sharing gibberish). */
  sentenceIndex: number;
  /** Which word in the reading this replaces. */
  wordIndex: number;
  /** The reader's best guess, used for the seed and the length. */
  guess?: string;
  /** Capitalize the first letter (the word starts a sentence). */
  capitalize?: boolean;
  /** Words it must not come out as, such as the words of the target sentence. */
  avoid?: Iterable<string>;
}

/** A silly made-up word about as long as the guess, e.g. "Snorfoodle" or "zibix". */
export function gibberishWord(options: GibberishOptions): string {
  const guess = (options.guess ?? '').trim();
  const letters = guess.replace(/[^\p{L}\p{N}]/gu, '').length;
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, letters || 5));
  const avoid = new Set([...(options.avoid ?? [])].map((w) => w.toLowerCase()));
  const random = seededRandom(hash(`${options.sentenceIndex}:${options.wordIndex}:${guess}`));

  let word = 'blorpix';
  const all = [...SHORT, ...SYLLABLES];
  for (let attempt = 0; attempt < 20; attempt++) {
    let candidate: string = pick(SHORT, random);
    if (length === 4) candidate += pick(LINKS, random);
    if (length > 4) {
      candidate = pick(
        all.filter((p) => p.length <= length - 2),
        random,
      );
      while (candidate.length + 4 < length) candidate += pick(LINKS, random) + pick(all, random);
      const room = Math.max(1, length - candidate.length + 1);
      candidate += pick(
        ENDS.filter((p) => p.length <= room),
        random,
      );
    }
    if (isAllowedGibberish(candidate, avoid)) {
      word = candidate;
      break;
    }
  }
  return options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
