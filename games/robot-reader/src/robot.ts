import type { AttemptInput } from '@braincade/game-sdk';
import {
  type Comparison,
  findWordIndex,
  flattenReading,
  type ReadWord,
  sentenceWords,
  splitToken,
} from './compare';
import { gibberishWord } from './gibberish';

/** One word of what the robot "read": real text, or gibberish for an unreadable word. */
export interface ReadBackWord {
  text: string;
  gibberish: boolean;
}

const KEEP_TRAILING = /[^.,!?;:]/g;

/**
 * What the robot reads back. Legible words come through as written (misspellings
 * and all); unreadable ones become silly made-up words. Indexes line up with
 * `flattenReading`, and so with `readIndex` in a comparison.
 */
export function buildReadBack(
  reading: readonly ReadWord[],
  sentenceIndex: number,
  avoid: readonly string[] = [],
): ReadBackWord[] {
  const out: ReadBackWord[] = [];
  flattenReading(reading).forEach((word, wordIndex) => {
    if (word.legible) {
      out.push({ text: word.text, gibberish: false });
      return;
    }
    const previous = out[out.length - 1]?.text ?? '';
    const startsSentence = previous === '' || /[.!?]$/.test(previous);
    const [, , trail] = splitToken(word.text);
    const made = gibberishWord({
      sentenceIndex,
      wordIndex,
      guess: word.text,
      capitalize: startsSentence,
      avoid,
    });
    out.push({ text: made + trail.replace(KEEP_TRAILING, ''), gibberish: true });
  });
  return out;
}

export function readBackText(words: readonly ReadBackWord[]): string {
  return words.map((w) => w.text).join(' ');
}

export type VerdictKind = 'perfect' | 'close' | 'confused' | 'scrambled' | 'blank';

export interface Verdict {
  kind: VerdictKind;
  message: string;
}

/** A short, encouraging line about how the reading went. */
export function verdict(comparison: Comparison, readCount: number): Verdict {
  const { correct, misspelled, missing, unreadable, extra, total } = comparison.counts;
  if (readCount === 0) {
    return {
      kind: 'blank',
      message: "Bzzt! I can't see any words. Is your writing in the photo?",
    };
  }
  if (total > 0 && unreadable * 2 >= total) {
    return {
      kind: 'scrambled',
      message: 'Blorp?! My circuits are scrambled. Try writing a bit bigger?',
    };
  }
  const problems = misspelled + missing + unreadable + extra;
  if (problems === 0 && correct === total) {
    return { kind: 'perfect', message: 'Perfect! I read every word!' };
  }
  const words = problems === 1 ? 'word' : 'words';
  if (problems <= 2) {
    return { kind: 'close', message: `The robot got confused by ${problems} ${words}. So close!` };
  }
  return {
    kind: 'confused',
    message: `The robot got confused by ${problems} ${words}. Keep going, you've got this!`,
  };
}

const MAX_RESPONSE = 120;

/**
 * The attempt to record for a sentence's target word, or `null` when the photo
 * says nothing about its spelling. Mastery treats a miss as "practice this
 * spelling again", so only a word the robot could read counts: spelled right
 * (`correct`) or wrong (`response` is the misspelling). An unreadable or missing
 * word is a handwriting or copying problem, and gibberish is never stored as an answer.
 */
export function targetAttempt(
  word: string,
  sentence: string,
  comparison: Comparison,
): AttemptInput | null {
  const result = comparison.words[findWordIndex(sentenceWords(sentence), word)];
  if (result?.status !== 'correct' && result?.status !== 'misspelled') return null;
  return {
    word,
    correct: result.status === 'correct',
    mode: 'handwritten',
    response: splitToken(result.read ?? '')[1].slice(0, MAX_RESPONSE),
  };
}
