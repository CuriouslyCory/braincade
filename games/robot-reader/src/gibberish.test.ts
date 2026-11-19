import { describe, expect, it } from 'vitest';
import { gibberishWord, isAllowedGibberish } from './gibberish';

const words = (count: number, guess = 'banana') =>
  Array.from({ length: count }, (_, i) =>
    gibberishWord({ sentenceIndex: Math.floor(i / 20), wordIndex: i % 20, guess }),
  );

describe('gibberishWord', () => {
  it('is deterministic for the same seed', () => {
    const options = { sentenceIndex: 1, wordIndex: 3, guess: 'necesary' };
    expect(gibberishWord(options)).toBe(gibberishWord(options));
  });

  it('varies with the sentence, word position, and guess', () => {
    const made = new Set([
      ...words(40),
      gibberishWord({ sentenceIndex: 0, wordIndex: 0, guess: 'pickle' }),
    ]);
    expect(made.size).toBeGreaterThan(20);
  });

  it('is made of lowercase letters', () => {
    for (const word of words(200)) expect(word).toMatch(/^[a-z]+$/);
  });

  it('roughly matches the length of the guess', () => {
    for (const guess of ['a', 'to', 'cat', 'socks', 'necessary', 'accommodate', 'x'.repeat(40)]) {
      const target = Math.min(14, Math.max(3, guess.length));
      for (let i = 0; i < 30; i++) {
        const word = gibberishWord({ sentenceIndex: 0, wordIndex: i, guess });
        expect(Math.abs(word.length - target), `${guess} -> ${word}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('uses a medium length when there is no guess', () => {
    const word = gibberishWord({ sentenceIndex: 2, wordIndex: 2 });
    expect(word.length).toBeGreaterThanOrEqual(3);
    expect(word.length).toBeLessThanOrEqual(9);
  });

  it('capitalizes the first letter when asked', () => {
    const options = { sentenceIndex: 0, wordIndex: 0, guess: 'The' };
    const plain = gibberishWord(options);
    expect(gibberishWord({ ...options, capitalize: true })).toBe(
      plain.charAt(0).toUpperCase() + plain.slice(1),
    );
  });

  it('never produces a blocked or real word', () => {
    const guesses = ['a', 'is', 'cat', 'sock', 'pizza', 'walrus', 'pancake', 'microphone'];
    for (const guess of guesses) {
      for (let s = 0; s < 10; s++) {
        for (let w = 0; w < 25; w++) {
          const word = gibberishWord({ sentenceIndex: s, wordIndex: w, guess });
          expect(isAllowedGibberish(word), word).toBe(true);
        }
      }
    }
  });

  it('avoids words it is told to avoid', () => {
    const options = { sentenceIndex: 4, wordIndex: 1, guess: 'zz' };
    const first = gibberishWord(options);
    const second = gibberishWord({ ...options, avoid: [first.toUpperCase()] });
    expect(second).not.toBe(first);
  });
});

describe('isAllowedGibberish', () => {
  it('rejects rude fragments, known real words, and avoided words', () => {
    expect(isAllowedGibberish('zibassix')).toBe(false);
    expect(isAllowedGibberish('Plinko')).toBe(false);
    expect(isAllowedGibberish('walrus', new Set(['walrus']))).toBe(false);
    expect(isAllowedGibberish('snorfoodle')).toBe(true);
  });
});
