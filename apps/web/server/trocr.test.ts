import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readHandwriting } from './trocr';

// Runs the real model (a ~65 MB download on first use), so it's opt-in:
//   BRAINCADE_TROCR_TEST=1 pnpm --filter @braincade/web exec vitest run server/trocr.test.ts
const run = process.env.BRAINCADE_TROCR_TEST === '1';

describe.runIf(run)('readHandwriting (TrOCR)', () => {
  it('reads a photo of a handwritten sentence on ruled paper', { timeout: 180_000 }, async () => {
    // fixtures/penguin.jpg: "The penguin spoke a foreign language made of sneezes." on two lines.
    const photo = readFileSync(new URL('./fixtures/penguin.jpg', import.meta.url));
    const { words } = await readHandwriting(photo);
    const text = words.map((w) => w.text).join(' ');
    expect(text).toContain('penguin');
    expect(text).toContain('sneezes');
    expect(words.length).toBeGreaterThanOrEqual(8);
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
