import { describe, expect, it } from 'vitest';
import {
  applyAttempt,
  emptyMastery,
  MASTERED_BOX,
  type MasteryState,
  missedWords,
  selectWords,
  summarizeMastery,
  wordStatus,
} from './mastery';
import { poolWords, type WordList } from './words';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9);

const lists: WordList[] = [
  {
    id: 'week-1',
    title: 'Week 1',
    words: [
      { word: 'their', tags: ['homophone'] },
      { word: 'there', tags: ['homophone'] },
      { word: 'because', tags: [] },
      { word: 'separate', tags: ['tricky'] },
    ],
  },
  {
    id: 'week-2',
    title: 'Week 2',
    words: [{ word: 'Because', sentence: 'I stayed in because it rained.', tags: ['common'] }],
  },
];

const noShuffle = () => 0.999;

function play(state: MasteryState, word: string, results: boolean[], start = NOW): MasteryState {
  return results.reduce((s, correct, i) => applyAttempt(s, { word, correct }, start + i), state);
}

describe('poolWords', () => {
  it('merges duplicate words across lists case-insensitively', () => {
    const pool = poolWords(lists);
    expect(pool).toHaveLength(4);
    const because = pool.find((w) => w.key === 'because');
    expect(because?.tags).toEqual(['common']);
    expect(because?.sentence).toBe('I stayed in because it rained.');
    expect(because?.listId).toBe('week-1');
  });
});

describe('applyAttempt', () => {
  it('moves a word up one box per correct answer until mastered', () => {
    let state = emptyMastery();
    state = applyAttempt(state, { word: 'Their', correct: true }, NOW);
    expect(state.words.their?.box).toBe(2);
    expect(state.words.their?.dueAt).toBe(NOW + DAY);

    state = play(state, 'their', [true, true, true, true]);
    expect(state.words.their?.box).toBe(MASTERED_BOX);
    expect(wordStatus(state.words.their)).toBe('mastered');
  });

  it('drops a missed word to box 1, due immediately, and keeps the response', () => {
    let state = play(emptyMastery(), 'separate', [true, true, true]);
    state = applyAttempt(state, { word: 'separate', correct: false, response: 'seperate' }, NOW);
    expect(state.words.separate).toMatchObject({
      box: 1,
      correct: 3,
      incorrect: 1,
      lastResult: 'incorrect',
      dueAt: NOW,
      lastResponse: 'seperate',
    });
  });

  it('does not mutate the previous state', () => {
    const before = emptyMastery();
    applyAttempt(before, { word: 'there', correct: true }, NOW);
    expect(before.words).toEqual({});
  });
});

describe('selectWords', () => {
  const pool = poolWords(lists);

  it('returns new words when nothing has been practiced', () => {
    const picked = selectWords(pool, emptyMastery(), { count: 10, now: NOW, random: noShuffle });
    expect(picked).toHaveLength(4);
    expect(picked.every((w) => w.status === 'new')).toBe(true);
  });

  it('puts due words first, lowest box first, then new, then not-yet-due', () => {
    let state = play(emptyMastery(), 'their', [false]); // box 1, due now
    state = play(state, 'there', [true, true]); // box 3, due in 3 days
    state = play(state, 'because', [true], NOW - 2 * DAY); // box 2, due yesterday

    const picked = selectWords(pool, state, { count: 4, now: NOW, random: noShuffle });
    expect(picked.map((w) => w.key)).toEqual(['their', 'because', 'separate', 'there']);
  });

  it('filters by tag and respects count', () => {
    const picked = selectWords(pool, emptyMastery(), {
      count: 1,
      tags: ['homophone'],
      now: NOW,
      random: noShuffle,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0]?.tags).toContain('homophone');
  });

  it('skips mastered words until they are due unless asked', () => {
    const state = play(emptyMastery(), 'their', [true, true, true, true]);
    const keys = (s: ReturnType<typeof selectWords>) => s.map((w) => w.key);
    expect(keys(selectWords(pool, state, { count: 10, now: NOW }))).not.toContain('their');
    expect(
      keys(selectWords(pool, state, { count: 10, now: NOW, includeMastered: true })),
    ).toContain('their');
    expect(keys(selectWords(pool, state, { count: 10, now: NOW + 15 * DAY }))).toContain('their');
  });
});

describe('reports', () => {
  it('lists recently missed words, newest first', () => {
    let state = play(emptyMastery(), 'their', [false], NOW - 10 * DAY);
    state = play(state, 'there', [false], NOW - DAY);
    state = play(state, 'because', [false], NOW);
    state = play(state, 'separate', [false, true], NOW);
    expect(missedWords(state, NOW - 7 * DAY)).toEqual(['because', 'there']);
  });

  it('summarizes the pool by status', () => {
    let state = play(emptyMastery(), 'their', [true, true, true, true]);
    state = play(state, 'there', [false]);
    expect(summarizeMastery(poolWords(lists), state)).toEqual({
      total: 4,
      new: 2,
      learning: 1,
      mastered: 1,
    });
  });
});
