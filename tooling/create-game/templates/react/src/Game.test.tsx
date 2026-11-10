// @vitest-environment jsdom
import { createTestContext } from '@braincade/game-sdk/testing';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Game } from './Game';

afterEach(cleanup);

describe('Game', () => {
  it('records answers and reports a score on finish', async () => {
    const t = createTestContext({ words: ['because', 'their'] });
    render(<Game ctx={t.ctx} />);

    expect(await screen.findByTestId('word')).toHaveProperty('textContent', 'because');
    fireEvent.click(screen.getByRole('button', { name: /Hear it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByText('their')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Missed it' }));
    await screen.findByText('All done!');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(t.spoken).toEqual(['because']);
    expect(t.attempts.map((a) => [a.word, a.correct])).toEqual([
      ['because', true],
      ['their', false],
    ]);
    await expect.poll(() => t.exited).toEqual({ score: 1 });
  });
});
