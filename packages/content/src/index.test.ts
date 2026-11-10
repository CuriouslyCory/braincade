import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
