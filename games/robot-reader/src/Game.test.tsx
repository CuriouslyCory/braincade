// @vitest-environment jsdom
import { type GameWord, type HandwritingReading, HostError } from '@braincade/game-sdk';
import { createTestContext, type TestContextOptions } from '@braincade/game-sdk/testing';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import game from './index';

afterEach(cleanup);

const silly = (word: string, sentence?: string): GameWord => ({
  word,
  sentence,
  tags: ['silly-sentence'],
  listId: 'grade-5-silly-sentences',
  status: 'new',
  box: 0,
});

const PICKLE = silly('necessary', 'Is it necessary for a pickle to wear a tuxedo?');
const KNIGHT = silly('knight', 'The knight rode a skateboard into the bakery.');
const LLAMA = silly('weird', 'A weird llama knitted a scarf for the moon.');

type Read = NonNullable<TestContextOptions['read']>;

/** A read() that answers from a list, one per call. */
function readsInOrder(...answers: Array<HandwritingReading | string | Error>): Read {
  const queue = [...answers];
  return async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('no more readings queued');
    if (next instanceof Error) throw next;
    return next;
  };
}

function setup(options: TestContextOptions = {}) {
  const t = createTestContext({
    session: { capabilities: ['storage', 'speech', 'camera', 'handwriting'] },
    words: [PICKLE, KNIGHT, LLAMA],
    ...options,
  });
  const view = render(<Game ctx={t.ctx} />);
  return { t, view };
}

async function start() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
  return screen.findByTestId('prompt-sentence');
}

const snap = () => fireEvent.click(screen.getByRole('button', { name: 'Snap my writing' }));

describe('Robot Reader', () => {
  it('plays a full session, recording one attempt per sentence and the score', async () => {
    const llamaReading: HandwritingReading = {
      words: [
        { text: 'A', legible: true },
        { text: 'wierd', legible: false },
        ...'llama knitted a scarf for the moon.'
          .split(' ')
          .map((text) => ({ text, legible: true })),
      ],
    };
    const { t } = setup({
      read: readsInOrder(
        'Is it necessary for a pickle to wear a tuxedo?',
        'The nite rode a skateboard into the bakery.',
        llamaReading,
      ),
    });

    // Intro
    expect(await screen.findByText(/Grab a pencil and paper!/)).toBeTruthy();

    // Sentence 1: perfect
    const prompt = await start();
    expect(prompt.textContent).toBe(PICKLE.sentence);
    expect(prompt.querySelector('mark')?.textContent).toBe('necessary');
    expect(screen.getByTestId('sentence-progress').textContent).toBe('Sentence 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(t.spoken).toEqual([PICKLE.sentence]);
    snap();
    expect((await screen.findByTestId('robot-reading')).textContent).toBe(PICKLE.sentence);
    expect(screen.getByTestId('verdict').textContent).toBe('Perfect! I read every word!');
    expect(t.captures).toEqual([{ prompt: 'Snap your sentence' }]);
    expect(t.spoken.at(-1)).toBe(PICKLE.sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Next sentence' }));

    // Sentence 2: target word misspelled
    expect((await screen.findByTestId('prompt-sentence')).textContent).toBe(KNIGHT.sentence);
    snap();
    expect((await screen.findByTestId('robot-reading')).textContent).toBe(
      'The nite rode a skateboard into the bakery.',
    );
    expect(screen.getByTestId('verdict').textContent).toBe(
      'The robot got confused by 1 word. So close!',
    );
    const chips = screen.getByTestId('comparison').querySelectorAll('li');
    expect([...chips].map((c) => c.getAttribute('data-status'))).toEqual([
      'correct',
      'misspelled',
      ...Array(6).fill('correct'),
    ]);
    expect(chips[1]?.textContent).toContain('nite');
    fireEvent.click(screen.getByRole('button', { name: 'Next sentence' }));

    // Sentence 3: target word unreadable, so the robot makes up a word
    await screen.findByText('Sentence 3 of 3');
    snap();
    const reading = await screen.findByTestId('robot-reading');
    const gibberish = reading.querySelectorAll('.gibberish');
    expect(gibberish).toHaveLength(1);
    const madeUp = gibberish[0]?.textContent ?? '';
    expect(madeUp).toMatch(/^[a-z]+$/);
    expect(reading.textContent).toBe(`A ${madeUp} llama knitted a scarf for the moon.`);
    expect(t.spoken.at(-1)).toBe(`A ${madeUp} llama knitted a scarf for the moon.`);
    expect(screen.queryByRole('button', { name: 'Next sentence' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'See my score' }));

    // End
    expect((await screen.findByTestId('score-summary')).textContent).toBe(
      'You copied 3 sentences. The robot read 25 of 27 words correctly!',
    );
    expect(t.attempts).toEqual([
      { word: 'necessary', correct: true, mode: 'handwritten', response: 'necessary' },
      { word: 'knight', correct: false, mode: 'handwritten', response: 'nite' },
      // "weird" was unreadable: that says nothing about its spelling, so it isn't recorded.
    ]);
    expect(t.reads).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await expect.poll(() => t.exited).toEqual({ score: 25 });
  });

  it('stays on the prompt when the camera is cancelled', async () => {
    const { t } = setup({
      words: [PICKLE],
      photos: [null],
      read: readsInOrder(PICKLE.sentence ?? ''),
    });
    await start();
    snap();
    await waitFor(() => expect(t.captures).toHaveLength(1));
    expect(screen.getByTestId('prompt-sentence')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Snap my writing' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(t.reads).toEqual([]);

    snap();
    expect(await screen.findByTestId('robot-reading')).toBeTruthy();
    expect(t.captures).toHaveLength(2);
  });

  it('shows a friendly message when the camera fails and lets the learner retry', async () => {
    const { t } = setup({ words: [PICKLE], read: readsInOrder(PICKLE.sentence ?? '') });
    const capture = t.ctx.camera.capture;
    t.ctx.camera.capture = vi
      .fn<typeof capture>()
      .mockRejectedValueOnce(new Error('camera broke'))
      .mockImplementation(capture);
    await start();
    snap();
    expect((await screen.findByRole('alert')).textContent).toContain("camera didn't open");
    snap();
    expect(await screen.findByTestId('robot-reading')).toBeTruthy();
  });

  it("shows the host's explanation when camera access is turned off", async () => {
    const { t } = setup({ words: [PICKLE], read: readsInOrder(PICKLE.sentence ?? '') });
    t.ctx.camera.capture = async () => {
      throw new HostError('permission-denied', 'A grown-up can turn the camera on in Settings.');
    };
    await start();
    snap();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A grown-up can turn the camera on in Settings.',
    );
  });

  it('shows a reading error, then re-reads the same photo on Try again', async () => {
    const { t } = setup({
      words: [PICKLE],
      read: readsInOrder(
        new HostError('timeout', 'handwriting.read timed out'),
        PICKLE.sentence ?? '',
      ),
    });
    await start();
    snap();
    expect((await screen.findByTestId('read-error')).textContent).toContain('took too long');
    expect(screen.getByRole('img', { name: 'Your writing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('verdict')).textContent).toBe('Perfect! I read every word!');
    expect(t.reads).toHaveLength(2);
    expect(t.reads[0]).toBe(t.reads[1]);
    expect(t.captures).toHaveLength(1);
  });

  it('offers Retake when reading fails (e.g. offline)', async () => {
    const { t } = setup({
      words: [PICKLE],
      read: readsInOrder(new Error('Failed to fetch'), PICKLE.sentence ?? ''),
    });
    await start();
    snap();
    expect((await screen.findByTestId('read-error')).textContent).toContain('Check the internet');
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    expect(await screen.findByTestId('robot-reading')).toBeTruthy();
    expect(t.captures).toHaveLength(2);
  });

  it('replaces the attempt when the learner retakes the photo', async () => {
    const { t } = setup({
      words: [KNIGHT],
      read: readsInOrder(
        'The nite rode a skateboard into the bakery.',
        'The knight rode a skateboard into the bakery.',
      ),
    });
    await start();
    snap();
    expect((await screen.findByTestId('verdict')).textContent).toContain('confused by 1 word');
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    await waitFor(() =>
      expect(screen.getByTestId('verdict').textContent).toBe('Perfect! I read every word!'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'See my score' }));
    expect((await screen.findByTestId('score-summary')).textContent).toBe(
      'You copied 1 sentence. The robot read 8 of 8 words correctly!',
    );
    expect(t.attempts).toEqual([
      { word: 'knight', correct: true, mode: 'handwritten', response: 'knight' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await expect.poll(() => t.exited).toEqual({ score: 8 });
  });

  it('keeps the old result when a retake is cancelled', async () => {
    const { t } = setup({
      words: [KNIGHT],
      read: readsInOrder('The nite rode a skateboard into the bakery.'),
    });
    t.ctx.camera.capture = vi
      .fn<typeof t.ctx.camera.capture>()
      .mockResolvedValueOnce({ image: 'data:image/png;base64,AAAA', width: 1, height: 1 })
      .mockResolvedValueOnce(null);
    await start();
    snap();
    expect((await screen.findByTestId('verdict')).textContent).toContain('confused by 1 word');
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    await waitFor(() => expect(t.ctx.camera.capture).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('robot-reading').textContent).toContain('nite');
    expect(t.reads).toHaveLength(1);
  });

  it('gets scrambled when most words are unreadable, and still lets the learner move on', async () => {
    const { t } = setup({
      words: [PICKLE],
      read: () => ({
        words: Array.from({ length: 10 }, (_, i) => ({
          text: i === 0 ? 'Is' : '',
          legible: false,
        })),
      }),
    });
    await start();
    snap();
    expect((await screen.findByTestId('verdict')).textContent).toBe(
      'Blorp?! My circuits are scrambled. Try writing a bit bigger?',
    );
    const reading = screen.getByTestId('robot-reading');
    expect(reading.querySelectorAll('.gibberish')).toHaveLength(10);
    // The first made-up word starts the sentence, so it is capitalized.
    expect(reading.querySelector('.gibberish')?.textContent).toMatch(/^[A-Z][a-z]+$/);
    expect(t.spoken.at(-1)).toBe(reading.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'See my score' }));
    await screen.findByTestId('score-summary');
    // An unreadable target word says nothing about its spelling, so nothing is recorded.
    expect(t.attempts).toEqual([]);
  });

  it('handles a photo with no words', async () => {
    const { t } = setup({ words: [PICKLE], read: () => ({ words: [] }) });
    await start();
    snap();
    expect((await screen.findByTestId('verdict')).textContent).toContain("can't see any words");
    fireEvent.click(screen.getByRole('button', { name: 'See my score' }));
    await screen.findByTestId('score-summary');
    expect(t.attempts).toEqual([]);
  });

  it('skips words without a sentence and ignores other lists', async () => {
    setup({ words: ['because', silly('weird'), KNIGHT] });
    await start();
    expect(screen.getByTestId('prompt-sentence').textContent).toBe(KNIGHT.sentence);
    expect(screen.getByTestId('sentence-progress').textContent).toBe('Sentence 1 of 1');
  });

  it('says so when there are no silly sentences', async () => {
    const { t } = setup({ words: ['because', 'their'] });
    expect(await screen.findByTestId('no-sentences')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await expect.poll(() => t.exited).toEqual({});
  });

  it('shows an error when sentences cannot be loaded', async () => {
    const t = createTestContext();
    t.ctx.words.next = async () => {
      throw new Error('host unavailable');
    };
    render(<Game ctx={t.ctx} />);
    expect((await screen.findByRole('alert')).textContent).toContain('host unavailable');
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });

  it('works without speech', async () => {
    const { t } = setup({
      session: { capabilities: ['camera', 'handwriting'] },
      words: [PICKLE],
      read: readsInOrder(PICKLE.sentence ?? ''),
    });
    await start();
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull();
    snap();
    await screen.findByTestId('robot-reading');
    expect(screen.queryByRole('button', { name: 'Hear the robot' })).toBeNull();
    expect(t.spoken).toEqual([]);
  });

  it('stops speech on pause and on unmount', async () => {
    const { t, view } = setup({ words: [PICKLE], read: readsInOrder(PICKLE.sentence ?? '') });
    const stop = vi.spyOn(t.ctx.speech, 'stop');
    await start();
    snap();
    await screen.findByTestId('robot-reading');
    act(() => t.emit('pause'));
    expect(stop).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('mounts through the game definition and cleans up', async () => {
    const t = createTestContext({ words: [PICKLE] });
    const root = document.createElement('div');
    document.body.append(root);
    let dispose: Awaited<ReturnType<typeof game.mount>>;
    await act(async () => {
      dispose = await game.mount(root, t.ctx);
    });
    await waitFor(() => expect(root.textContent).toContain('Robot Reader'));
    await act(async () => {
      await dispose?.();
    });
    expect(root.textContent).toBe('');
    root.remove();
  });
});
