import { describe, expect, it } from 'vitest';
import { compareWords, type ReadWord } from './compare';
import { buildReadBack, readBackText, targetAttempt, verdict } from './robot';

const legible = (text: string): ReadWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ text: t, legible: true }));
const blur = (text = ''): ReadWord => ({ text, legible: false });

const SENTENCE = 'Is it necessary for a pickle to wear a tuxedo?';

describe('buildReadBack', () => {
  it('keeps legible words as written and swaps unreadable ones for gibberish', () => {
    const reading = [...legible('Is it necesary'), blur('fr'), ...legible('a pickle')];
    const words = buildReadBack(reading, 0);
    expect(words.map((w) => w.gibberish)).toEqual([false, false, false, true, false, false]);
    expect(words.slice(0, 3).map((w) => w.text)).toEqual(['Is', 'it', 'necesary']);
    expect(words[3]?.text).toMatch(/^[a-z]+$/);
    expect(buildReadBack(reading, 0)).toEqual(words);
  });

  it('capitalizes gibberish at the start of a sentence and keeps end punctuation', () => {
    const words = buildReadBack([blur('Is'), ...legible('it here.'), blur('Yes!')], 1);
    expect(words[0]?.text).toMatch(/^[A-Z][a-z]+$/);
    expect(words[3]?.text).toMatch(/^[A-Z][a-z]+!$/);
  });

  it('never turns an unreadable word into a word from the sentence', () => {
    const words = buildReadBack([blur('zz')], 4, ['tuxedo']);
    expect(words[0]?.text.toLowerCase()).not.toBe('tuxedo');
  });

  it('joins into speakable text', () => {
    expect(readBackText(buildReadBack(legible('a pickle'), 0))).toBe('a pickle');
  });
});

describe('verdict', () => {
  const verdictFor = (reading: ReadWord[]) =>
    verdict(compareWords(SENTENCE, reading), reading.length);

  it('celebrates a perfect copy', () => {
    expect(verdictFor(legible(SENTENCE))).toEqual({
      kind: 'perfect',
      message: 'Perfect! I read every word!',
    });
  });

  it('counts confusing words', () => {
    const v = verdictFor(legible('Is it necesary for a pikle to wear a tuxedo?'));
    expect(v.kind).toBe('close');
    expect(v.message).toBe('The robot got confused by 2 words. So close!');
    expect(verdictFor(legible('Is it necesary for a pickle to wear a tuxedo?')).message).toBe(
      'The robot got confused by 1 word. So close!',
    );
    expect(verdictFor(legible('Is it necesary four a pikle too wear a tuxedo?')).kind).toBe(
      'confused',
    );
  });

  it('gets scrambled when most words are unreadable', () => {
    const reading = [...legible('Is it necessary for'), ...Array.from({ length: 6 }, () => blur())];
    expect(verdictFor(reading)).toEqual({
      kind: 'scrambled',
      message: 'Blorp?! My circuits are scrambled. Try writing a bit bigger?',
    });
  });

  it('notices an empty photo', () => {
    expect(verdictFor([]).kind).toBe('blank');
  });
});

describe('targetAttempt', () => {
  const attemptFor = (reading: ReadWord[]) => {
    const comparison = compareWords(SENTENCE, reading);
    return targetAttempt('necessary', SENTENCE, comparison, buildReadBack(reading, 0));
  };

  it('is correct when the target word is read and spelled right', () => {
    expect(attemptFor(legible('Is it necessary for a pikle to wear a tuxedo?'))).toEqual({
      word: 'necessary',
      correct: true,
      mode: 'handwritten',
      response: 'necessary',
    });
  });

  it('records the misspelling without punctuation', () => {
    expect(attemptFor(legible('Is it necesary, for a pickle'))).toMatchObject({
      correct: false,
      response: 'necesary',
    });
  });

  it('records the gibberish for an unreadable target word', () => {
    const reading = [...legible('Is it'), blur('nec'), ...legible('for a pickle')];
    const attempt = attemptFor(reading);
    expect(attempt.correct).toBe(false);
    expect(attempt.response).toBe(buildReadBack(reading, 0)[2]?.text);
  });

  it('records an empty response when the word is missing', () => {
    expect(attemptFor(legible('Is it for a pickle to wear a tuxedo?'))).toMatchObject({
      correct: false,
      response: '',
    });
    expect(attemptFor([])).toMatchObject({ correct: false, response: '' });
  });

  it('finds a capitalized target at the start of the sentence', () => {
    const sentence = 'Tomorrow my socks will run for class president.';
    const reading = legible('tomorow my socks will run for class president.');
    const attempt = targetAttempt(
      'tomorrow',
      sentence,
      compareWords(sentence, reading),
      buildReadBack(reading, 0),
    );
    expect(attempt).toMatchObject({ correct: false, response: 'tomorow' });
  });

  it('keeps the response within the attempt limit', () => {
    const long = 'n'.repeat(60);
    const sentence = 'necessary';
    const reading = legible(`${long}${long}${long}`);
    const attempt = targetAttempt(
      'necessary',
      sentence,
      compareWords(sentence, reading),
      buildReadBack(reading, 0),
    );
    expect(attempt.response?.length).toBeLessThanOrEqual(120);
  });
});
