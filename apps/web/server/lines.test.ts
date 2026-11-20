import { describe, expect, it } from 'vitest';
import { findLines, inkMask, lineImage, toGray } from './lines';

const W = 400;
const H = 300;

/** A pale page with a faint ruled line and two dark "lines of writing". */
function page() {
  const rgba = new Uint8Array(W * H * 4).fill(240);
  const paint = (x0: number, y0: number, x1: number, y1: number, value: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) rgba.fill(value, (y * W + x) * 4, (y * W + x) * 4 + 3);
    }
  };
  paint(0, 140, W, 142, 200); // ruled line: lighter than ink
  // "Words": strokes with gaps, like letters.
  for (let x = 40; x < 300; x += 12) paint(x, 50, x + 6, 90, 30);
  for (let x = 60; x < 260; x += 12) paint(x, 190, x + 6, 235, 40);
  return rgba;
}

describe('inkMask', () => {
  it('marks dark strokes as ink and leaves paper and faint rules alone', () => {
    const ink = inkMask(toGray(page(), W, H), W, H);
    expect(ink[70 * W + 42]).toBe(1); // inside a stroke
    expect(ink[20 * W + 20]).toBe(0); // blank paper
    expect(ink[141 * W + 350]).toBe(0); // ruled line
  });

  it('copes with uneven lighting', () => {
    const rgba = page();
    // Darken the right half, as in a shadowed photo.
    for (let y = 0; y < H; y++) {
      for (let x = W / 2; x < W; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * W + x) * 4 + c;
          rgba[i] = Math.round((rgba[i] ?? 0) * 0.6);
        }
      }
    }
    const ink = inkMask(toGray(rgba, W, H), W, H);
    expect(ink[70 * W + 270]).toBe(1); // stroke in the shadow
    expect(ink[20 * W + 380]).toBe(0); // shadowed paper is still paper
  });
});

describe('findLines', () => {
  it('finds each line of writing, top to bottom, padded and trimmed to the ink', () => {
    const ink = inkMask(toGray(page(), W, H), W, H);
    const lines = findLines(ink, W, H);
    expect(lines).toHaveLength(2);
    const [first, second] = lines;
    expect(first?.y0).toBeLessThan(50);
    expect(first?.y1).toBeGreaterThan(90);
    expect(first?.y1).toBeLessThanOrEqual(second?.y0 ?? 0);
    expect(first?.x0).toBeLessThan(40);
    expect(first?.x1).toBeGreaterThan(290);
  });

  it('finds nothing on a blank page', () => {
    const blank = new Uint8Array(W * H);
    expect(findLines(blank, W, H)).toEqual([]);
  });

  it('caps the number of lines', () => {
    const tall = 1000;
    const ink = new Uint8Array(W * tall);
    for (let line = 0; line < 10; line++) {
      for (let y = line * 100 + 20; y < line * 100 + 60; y++) ink.fill(1, y * W + 20, y * W + 300);
    }
    expect(findLines(ink, W, tall)).toHaveLength(8);
    expect(findLines(ink, W, tall, 4)).toHaveLength(4);
  });
});

describe('lineImage', () => {
  it('renders ink as black on white', () => {
    const ink = new Uint8Array(W * H);
    ink[10 * W + 10] = 1;
    const { rgb, width, height } = lineImage(ink, W, { x0: 5, y0: 5, x1: 15, y1: 15 });
    expect([width, height]).toEqual([10, 10]);
    expect(Array.from(rgb.subarray((5 * 10 + 5) * 3, (5 * 10 + 5) * 3 + 3))).toEqual([0, 0, 0]);
    expect(Array.from(rgb.subarray(0, 3))).toEqual([255, 255, 255]);
  });
});
