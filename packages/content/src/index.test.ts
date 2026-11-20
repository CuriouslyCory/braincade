import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { poolWords, wordKey } from '@braincade/learning';
import { describe, expect, it } from 'vitest';
import { wordLists } from './index';

const listsDir = fileURLToPath(new URL('../word-lists', import.meta.url));

describe('word lists', () => {
  it('registers every JSON file in word-lists/ and names files after their id', () => {
    const files = readdirSync(listsDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(wordLists.map((l) => `${l.id}.json`).sort()).toEqual(files);
  });

  it('has unique list ids and no duplicate words within a list', () => {
    const ids = wordLists.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const list of wordLists) {
      const words = list.words.map((w) => w.word.toLowerCase());
      expect(new Set(words).size, list.id).toBe(words.length);
    }
  });

  it('uses each word in its example sentence', () => {
    for (const list of wordLists) {
      for (const { word, sentence } of list.words) {
        if (sentence) expect(sentence.toLowerCase(), word).toContain(word.toLowerCase());
      }
    }
  });
});

/** Robot Reader asks for these; the learner copies the sentence by hand. */
const SILLY_TAG = 'silly-sentence';
const SILLY_MAX_CHARS = 80;
const SILLY_WORDS = { min: 6, max: 12 };
const sillyEntries = wordLists.flatMap((list) =>
  list.words.filter((w) => w.tags.includes(SILLY_TAG)).map((entry) => ({ list, entry })),
);

/** Words split on spaces, with surrounding punctuation removed and curly apostrophes made straight. */
function sentenceWords(sentence: string): string[] {
  return sentence
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
}

describe('silly sentences', () => {
  it('exists', () => {
    expect(sillyEntries.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps every sentence short enough to copy by hand', () => {
    for (const { entry } of sillyEntries) {
      const sentence = entry.sentence ?? '';
      expect(sentence.length, entry.word).toBeGreaterThan(0);
      expect(sentence.length, sentence).toBeLessThanOrEqual(SILLY_MAX_CHARS);
      const count = sentence.split(/\s+/).length;
      expect(count, sentence).toBeGreaterThanOrEqual(SILLY_WORDS.min);
      expect(count, sentence).toBeLessThanOrEqual(SILLY_WORDS.max);
      // Plain ASCII only, so the sentence looks the same on every device and keyboard.
      expect(sentence, sentence).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('contains the target word as a whole word, so the game can find and score it', () => {
    for (const { entry } of sillyEntries) {
      expect(sentenceWords(entry.sentence ?? ''), entry.sentence).toContain(
        entry.word.toLowerCase(),
      );
    }
  });

  it('does not reuse a word from another list, so the silly sentence survives pooling', () => {
    for (const { list, entry } of sillyEntries) {
      const elsewhere = wordLists.filter(
        (other) =>
          other.id !== list.id && other.words.some((w) => wordKey(w.word) === wordKey(entry.word)),
      );
      expect(
        elsewhere.map((l) => l.id),
        entry.word,
      ).toEqual([]);
    }
    const pooled = new Map(poolWords(wordLists).map((w) => [w.key, w]));
    for (const { entry } of sillyEntries) {
      expect(pooled.get(wordKey(entry.word))?.sentence, entry.word).toBe(entry.sentence);
    }
  });
});
