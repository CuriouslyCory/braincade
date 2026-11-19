import { describe, expect, it } from 'vitest';
import {
  compareWords,
  findWordIndex,
  flattenReading,
  normalizeWord,
  type ReadWord,
  sentenceWords,
  splitToken,
} from './compare';

const legible = (text: string): ReadWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ text: t, legible: true }));
const blur = (text = ''): ReadWord => ({ text, legible: false });
const statuses = (sentence: string, reading: ReadWord[]) =>
  compareWords(sentence, reading).words.map((w) => w.status);

const SENTENCE = 'The walrus hid his socks.';

describe('normalizeWord', () => {
  it('ignores case and surrounding punctuation', () => {
    expect(normalizeWord('Walrus,')).toBe('walrus');
    expect(normalizeWord('"Hello!"')).toBe('hello');
    expect(normalizeWord('(socks).')).toBe('socks');
    expect(normalizeWord('...')).toBe('');
  });

  it('treats curly and straight apostrophes alike but keeps internal ones', () => {
    expect(normalizeWord('don’t')).toBe("don't");
    expect(normalizeWord("It's")).toBe("it's");
    expect(normalizeWord('its')).not.toBe(normalizeWord("it's"));
    expect(normalizeWord("'quoted'")).toBe('quoted');
  });
});

describe('splitToken / sentenceWords / findWordIndex', () => {
  it('splits punctuation from the word', () => {
    expect(splitToken('"Hello,"')).toEqual(['"', 'Hello', ',"']);
    expect(splitToken('socks')).toEqual(['', 'socks', '']);
    expect(splitToken("don't.")).toEqual(['', "don't", '.']);
  });

  it('finds the target word regardless of case and punctuation', () => {
    const words = sentenceWords('Tomorrow my socks will run, I think - wow!');
    expect(words).toEqual(['Tomorrow', 'my', 'socks', 'will', 'run,', 'I', 'think', 'wow!']);
    expect(findWordIndex(words, 'tomorrow')).toBe(0);
    expect(findWordIndex(words, 'run')).toBe(4);
    expect(findWordIndex(words, 'missing')).toBe(-1);
  });
});

describe('flattenReading', () => {
  it('splits multi-word entries and drops legible punctuation', () => {
    expect(
      flattenReading([
        { text: 'the walrus', legible: true },
        { text: '.', legible: true },
      ]),
    ).toEqual([
      { text: 'the', legible: true },
      { text: 'walrus', legible: true },
    ]);
  });

  it('keeps unreadable words even with no guess', () => {
    expect(flattenReading([blur(''), blur('  '), blur('a b')])).toEqual([
      blur(''),
      blur(''),
      blur('a'),
      blur('b'),
    ]);
  });
});

describe('compareWords', () => {
  it('marks a perfect copy correct, ignoring case and punctuation', () => {
    const result = compareWords(SENTENCE, legible('the WALRUS hid his socks'));
    expect(result.words.map((w) => w.status)).toEqual(Array(5).fill('correct'));
    expect(result.counts).toEqual({
      correct: 5,
      misspelled: 0,
      missing: 0,
      unreadable: 0,
      extra: 0,
      total: 5,
    });
    expect(result.extras).toEqual([]);
  });

  it('marks a misspelled word in place and keeps what was read', () => {
    const result = compareWords(SENTENCE, legible('The walrus hid his sox.'));
    expect(result.words.map((w) => w.status)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
      'misspelled',
    ]);
    expect(result.words[4]).toMatchObject({ expected: 'socks.', read: 'sox.', readIndex: 4 });
  });

  it('counts a completely different word in the same spot as misspelled', () => {
    expect(statuses(SENTENCE, legible('The walrus ate his socks'))).toEqual([
      'correct',
      'correct',
      'misspelled',
      'correct',
      'correct',
    ]);
  });

  it('does not shift everything after a missing word', () => {
    const result = compareWords(SENTENCE, legible('The walrus his socks'));
    expect(result.words.map((w) => w.status)).toEqual([
      'correct',
      'correct',
      'missing',
      'correct',
      'correct',
    ]);
    expect(result.words[2]?.read).toBeUndefined();
    expect(result.counts.missing).toBe(1);
  });

  it('reports an extra word without shifting the rest', () => {
    const result = compareWords(SENTENCE, legible('The big walrus hid his socks'));
    expect(result.words.every((w) => w.status === 'correct')).toBe(true);
    expect(result.extras).toEqual([{ read: 'big', readIndex: 1, legible: true, after: 0 }]);
    expect(result.aligned.map((a) => (a.kind === 'extra' ? `+${a.read}` : a.expected))).toEqual([
      'The',
      '+big',
      'walrus',
      'hid',
      'his',
      'socks.',
    ]);
  });

  it('handles extra words at the start and end', () => {
    const result = compareWords('cats nap', legible('so cats nap a lot'));
    expect(result.words.map((w) => w.status)).toEqual(['correct', 'correct']);
    expect(result.extras.map((e) => [e.read, e.after])).toEqual([
      ['so', -1],
      ['a', 1],
      ['lot', 1],
    ]);
  });

  it('pairs a misspelled word with its look-alike when a neighbour is missing', () => {
    expect(statuses('The big cat sat', legible('The cta sat'))).toEqual([
      'correct',
      'missing',
      'misspelled',
      'correct',
    ]);
  });

  it('aligns unreadable words as unreadable', () => {
    const result = compareWords(SENTENCE, [
      ...legible('The walrus'),
      blur('hjd'),
      ...legible('his socks'),
    ]);
    expect(result.words.map((w) => w.status)).toEqual([
      'correct',
      'correct',
      'unreadable',
      'correct',
      'correct',
    ]);
    expect(result.words[2]).toMatchObject({ read: 'hjd', readIndex: 2 });
  });

  it('counts an unreadable word as unreadable even when the guess matches', () => {
    expect(statuses('cats nap', [blur('cats'), ...legible('nap')])).toEqual([
      'unreadable',
      'correct',
    ]);
  });

  it('marks every word unreadable when nothing could be read', () => {
    const result = compareWords(SENTENCE, [blur(), blur(), blur(), blur(), blur()]);
    expect(result.counts.unreadable).toBe(5);
    expect(result.extras).toEqual([]);
  });

  it('marks every word missing for an empty reading', () => {
    const result = compareWords(SENTENCE, []);
    expect(result.words.map((w) => w.status)).toEqual(Array(5).fill('missing'));
    expect(result.counts).toMatchObject({ missing: 5, correct: 0, total: 5 });
  });

  it('treats curly apostrophes as straight and keeps its / it’s different', () => {
    expect(statuses("Don't eat it's lunch", legible('don’t eat it’s lunch'))).toEqual(
      Array(4).fill('correct'),
    );
    expect(statuses("It's raining", legible('Its raining'))).toEqual(['misspelled', 'correct']);
  });

  it('ignores lone punctuation in the reading', () => {
    expect(statuses('Stop, wait!', legible('Stop , wait !'))).toEqual(['correct', 'correct']);
  });

  it('copes with an empty sentence', () => {
    const result = compareWords('', legible('hello'));
    expect(result.words).toEqual([]);
    expect(result.extras).toHaveLength(1);
  });
});
