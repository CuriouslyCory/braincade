import { describe, expect, it } from 'vitest';
import { createTestContext, TEST_IMAGE } from './testing';

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

  it('fakes the camera and handwriting reader', async () => {
    const t = createTestContext({
      session: { capabilities: ['camera', 'handwriting'] },
      photos: [null],
      read: () => 'Teh cat',
    });
    expect(await t.ctx.camera.capture({ prompt: 'Snap it' })).toBeNull();
    const photo = await t.ctx.camera.capture();
    expect(photo).toEqual(TEST_IMAGE);
    expect(await t.ctx.handwriting.read(TEST_IMAGE)).toEqual({
      words: [
        { text: 'Teh', legible: true },
        { text: 'cat', legible: true },
      ],
    });
    expect(t.captures).toEqual([{ prompt: 'Snap it' }, {}]);
    expect(t.reads).toEqual([TEST_IMAGE.image]);
  });

  it('rejects camera and handwriting when the capability is missing', async () => {
    const t = createTestContext();
    await expect(t.ctx.camera.capture()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(t.ctx.handwriting.read(TEST_IMAGE)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
