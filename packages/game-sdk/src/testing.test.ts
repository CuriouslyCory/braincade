import { describe, expect, it } from 'vitest';
import { createTestContext } from './testing';

describe('createTestContext', () => {
  it('records what a game does through the context', async () => {
    const t = createTestContext({ words: ['their', 'there'] });
    const words = await t.ctx.words.next({ count: 1 });
    await t.ctx.speech.speak(words[0]?.word ?? '');
    await t.ctx.progress.record({
      word: 'their',
      correct: false,
      mode: 'typed',
      response: 'thier',
    });
    await t.ctx.print({
      title: 'Rematch',
      pages: [{ blocks: [{ type: 'word-practice', words: ['their'] }] }],
    });
    await t.ctx.storage.set('best', { score: 3 });
    await t.ctx.exit({ score: 3 });

    expect(t.spoken).toEqual(['their']);
    expect(t.attempts).toEqual([
      { word: 'their', correct: false, mode: 'typed', response: 'thier' },
    ]);
    expect(t.printed[0]?.pages[0]?.blocks[0]).toMatchObject({ type: 'word-practice', repeats: 3 });
    expect(await t.ctx.storage.get('best')).toEqual({ score: 3 });
    expect(t.exited).toEqual({ score: 3 });
  });

  it('emits lifecycle events to subscribers', () => {
    const t = createTestContext();
    let paused = 0;
    const off = t.ctx.on('pause', () => paused++);
    t.emit('pause');
    off();
    t.emit('pause');
    expect(paused).toBe(1);
  });

  it('honours capability overrides', () => {
    const t = createTestContext({ session: { capabilities: ['storage'] } });
    expect(t.ctx.has('speech')).toBe(false);
    expect(t.ctx.has('storage')).toBe(true);
  });
});
