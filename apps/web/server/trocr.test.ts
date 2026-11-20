import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readHandwriting } from './trocr';

// Runs the real model (a ~65 MB download on first use), so it's opt-in:
//   BRAINCADE_TROCR_TEST=1 pnpm --filter @braincade/web exec vitest run server/trocr.test.ts
const run = process.env.BRAINCADE_TROCR_TEST === '1';

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Words that differ between what was written and what was read (edit distance). */
function wordErrors(expected: string, read: string): number {
  const a = words(expected);
  const b = words(read);
  let previous = b.map((_, j) => j + 1);
  previous.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

async function read(fixture: string): Promise<string> {
  const photo = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
  const reading = await readHandwriting(photo);
  return reading.words.map((w) => w.text).join(' ');
}

describe.runIf(run)('readHandwriting (TrOCR)', () => {
  it.each([
    // A clean scan-like photo: two lines on faintly ruled paper.
    ['penguin.jpg', 'The penguin spoke a foreign language made of sneezes.'],
    // Green paper held up in a busy room, slightly rotated, with print beside the page.
    ['green-paper.jpg', 'Be careful, the jelly is planning a sneaky escape.'],
    // Lined paper with a dashed red margin; the writing sits on the rules.
    ['lined-paper.jpg', 'Is it necessary for a pickle to wear a tuxedo?'],
  ])('reads %s', { timeout: 180_000 }, async (fixture, expected) => {
    const text = await read(fixture);
    expect(wordErrors(expected, text), text).toBeLessThanOrEqual(1);
  });

  it('finds no words on a blank page', { timeout: 60_000 }, async () => {
    const sharp = (await import('sharp')).default;
    const blank = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#f6f4ec' },
    })
      .jpeg()
      .toBuffer();
    expect(await readHandwriting(blank)).toEqual({ words: [] });
  });
});
