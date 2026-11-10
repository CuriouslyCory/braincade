import { describe, expect, it } from 'vitest';
import { createLearnerRepository, createMemoryStore } from './repository';

const tick = async () => {
  await null;
};

describe('createLearnerRepository', () => {
  it('returns defaults for an empty store', async () => {
    const repo = createLearnerRepository(createMemoryStore());
    expect(await repo.getProfile()).toEqual({ name: '', interests: [], showDrafts: false });
    expect(await repo.getMastery()).toEqual({ version: 1, words: {} });
    expect(await repo.getSessions()).toEqual([]);
  });

  it('merges profile updates', async () => {
    const repo = createLearnerRepository(createMemoryStore());
    await repo.saveProfile({ name: 'Sam' });
    await repo.saveProfile({ interests: ['minecraft'] });
    expect(await repo.getProfile()).toEqual({
      name: 'Sam',
      interests: ['minecraft'],
      showDrafts: false,
    });
  });

  it('serializes concurrent attempt writes so none are lost', async () => {
    const store = createMemoryStore();
    // Simulate an async store (AsyncStorage) to expose read-modify-write races.
    const asyncStore = {
      getItem: async (key: string) => {
        await tick();
        return store.getItem(key);
      },
      setItem: async (key: string, value: string) => {
        await tick();
        store.setItem(key, value);
      },
    };
    const repo = createLearnerRepository(asyncStore);
    await Promise.all([
      repo.recordAttempts([{ word: 'their', correct: true }]),
      repo.recordAttempts([{ word: 'there', correct: false }]),
      repo.recordAttempts([{ word: 'because', correct: true }]),
    ]);
    expect(Object.keys((await repo.getMastery()).words).sort()).toEqual([
      'because',
      'their',
      'there',
    ]);
  });

  it('falls back to defaults when stored data is corrupt', async () => {
    const store = createMemoryStore({
      'braincade:profile': '{not json',
      'braincade:mastery': JSON.stringify({ version: 99 }),
    });
    const repo = createLearnerRepository(store);
    expect((await repo.getProfile()).name).toBe('');
    expect((await repo.getMastery()).words).toEqual({});
  });

  it('drops individual corrupt word records and keeps the rest', async () => {
    const good = {
      box: 3,
      correct: 2,
      incorrect: 0,
      lastResult: 'correct',
      lastSeenAt: 1,
      dueAt: 2,
    };
    const store = createMemoryStore({
      'braincade:mastery': JSON.stringify({
        version: 1,
        words: { their: good, there: { box: 'two' }, because: { ...good, dueAt: undefined } },
      }),
    });
    const repo = createLearnerRepository(store);
    expect((await repo.getMastery()).words).toEqual({ their: good });
  });

  it('scopes game data by game id and prefix', async () => {
    const store = createMemoryStore();
    const repo = createLearnerRepository(store, { prefix: 'test:' });
    await repo.gameData('spell-race').set('best', 12);
    expect(await repo.gameData('spell-race').get('best')).toBe(12);
    expect(await repo.gameData('other').get('best')).toBeUndefined();
    expect(store.data.has('test:game:spell-race:best')).toBe(true);
  });

  it('records sessions', async () => {
    const repo = createLearnerRepository(createMemoryStore());
    await repo.recordSession({
      id: 's1',
      gameId: 'g',
      gameVersion: '0.1.0',
      startedAt: 1,
      endedAt: 2,
      attempts: 3,
      correct: 2,
    });
    expect(await repo.getSessions()).toHaveLength(1);
  });
});
