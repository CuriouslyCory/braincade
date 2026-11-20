import { describe, expect, it } from 'vitest';
import {
  findLines,
  inkMask,
  type LineBox,
  lineImage,
  removeRules,
  type TextLine,
  toBrightness,
} from './lines';

const W = 800;
const H = 500;

/** An RGBA "photo": a dark, busy room with a sheet of paper in it. */
function photo({ paper = [240, 240, 236], room = [70, 60, 55] } = {}) {
  const rgba = new Uint8Array(W * H * 4);
  const paint = (x0: number, y0: number, x1: number, y1: number, rgb: number[]) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        rgba.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], (y * W + x) * 4);
      }
    }
  };
  paint(0, 0, W, H, room);
  // Texture in the room, so it isn't one flat colour.
  for (let y = 0; y < H; y += 23) paint(0, y, W, y + 9, [110, 95, 80]);
  const page = { x0: 150, y0: 60, x1: 650, y1: 460 };
  paint(page.x0, page.y0, page.x1, page.y1, paper);
  /** A hollow letter-sized box: thin strokes, like a written letter. */
  const letter = (x: number, y: number, w = 18, h = 28, ink = [30, 30, 40]) => {
    paint(x, y, x + w, y + 4, ink);
    paint(x, y + h - 4, x + w, y + h, ink);
    paint(x, y, x + 4, y + h, ink);
    paint(x + w - 4, y, x + w, y + h, ink);
  };
  /** A word of `n` letters starting at x, returning where it ends. */
  const word = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) letter(x + i * 24, y);
    return x + n * 24;
  };
  return { rgba, paint, letter, word, page };
}

function lines(rgba: Uint8Array) {
  const brightness = toBrightness(rgba, W, H);
  const ink = inkMask(brightness, W, H);
  return findLines(ink, W, H, { rgba });
}

const centreY = (b: LineBox) => (b.y0 + b.y1) / 2;

describe('toBrightness', () => {
  it("uses each pixel's brightest channel, so coloured rules and margins read as paper", () => {
    const rgba = new Uint8Array([180, 200, 230, 255, 230, 80, 80, 255, 30, 30, 40, 255]);
    expect(Array.from(toBrightness(rgba, 3, 1))).toEqual([230, 230, 40]);
  });
});

describe('inkMask', () => {
  it('marks dark strokes as ink and leaves paper and coloured rules alone', () => {
    const p = photo();
    p.paint(160, 200, 640, 202, [170, 190, 225]); // light blue rule
    p.letter(200, 100);
    const ink = inkMask(toBrightness(p.rgba, W, H), W, H);
    expect(ink[101 * W + 202]).toBe(1); // a stroke
    expect(ink[300 * W + 400]).toBe(0); // blank paper
    expect(ink[201 * W + 400]).toBe(0); // the rule
  });

  it('copes with uneven lighting', () => {
    const p = photo();
    p.letter(500, 100);
    for (let y = 0; y < H; y++) {
      for (let x = 400; x < W; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * W + x) * 4 + c;
          p.rgba[i] = Math.round((p.rgba[i] ?? 0) * 0.6); // a shadow over the right side
        }
      }
    }
    const ink = inkMask(toBrightness(p.rgba, W, H), W, H);
    expect(ink[101 * W + 502]).toBe(1);
    expect(ink[300 * W + 450]).toBe(0);
  });
});

describe('removeRules', () => {
  it('erases long thin rules and margins, even dashed, but not letters crossing them', () => {
    const ink = new Uint8Array(W * H);
    const set = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) ink.fill(1, y * W + x0, y * W + x1);
    };
    for (let x = 100; x < 700; x += 12) set(x, 200, x + 9, 202); // dashed rule
    for (let y = 50; y < 450; y += 10) set(300, y, 302, y + 8); // dashed margin
    set(400, 180, 405, 225); // a letter's stroke crossing the rule
    const out = removeRules(ink, W, H);
    expect(out[201 * W + 150]).toBe(0);
    expect(out[100 * W + 301]).toBe(0);
    expect(out[190 * W + 402]).toBe(1);
    expect(out[201 * W + 402]).toBe(1);
  });
});

describe('findLines', () => {
  it('finds the lines written on the page, top to bottom, and ignores the room', () => {
    const p = photo();
    p.word(p.word(200, 120, 4) + 30, 120, 3);
    p.word(p.word(200, 190, 3) + 30, 190, 5);
    // Letter-sized marks in the room, beside the first line.
    for (let i = 0; i < 4; i++) p.letter(20 + i * 24, 120);
    const { lines: found } = lines(p.rgba);
    expect(found).toHaveLength(2);
    expect(centreY(found[0] as TextLine)).toBeLessThan(centreY(found[1] as TextLine));
    expect(found[0]?.components).toHaveLength(7);
    expect(found[1]?.components).toHaveLength(8);
    for (const line of found) expect(line.x0).toBeGreaterThan(p.page.x0);
  });

  it('works on coloured paper and with rules and a margin on the page', () => {
    const p = photo({ paper: [140, 210, 60] });
    for (let y = 100; y < 450; y += 70) p.paint(155, y + 30, 645, y + 32, [120, 150, 220]);
    p.paint(190, 65, 192, 455, [230, 70, 70]); // margin
    p.word(p.word(205, 104, 4) + 30, 104, 4);
    const { lines: found } = lines(p.rgba);
    expect(found).toHaveLength(1);
    expect(found[0]?.components).toHaveLength(8);
  });

  it('keeps thin strokes like l and I', () => {
    const p = photo();
    p.word(200, 150, 2);
    p.paint(252, 140, 257, 178, [30, 30, 40]); // an "l", taller and thinner than the rest
    p.word(264, 150, 2);
    const { lines: found } = lines(p.rgba);
    expect(found[0]?.components).toHaveLength(5);
  });

  it('allows wide spacing between lines but not writing far down the page', () => {
    const p = photo();
    p.word(200, 100, 6);
    p.word(200, 190, 6); // a line skipped
    p.word(200, 420, 6); // something else near the bottom
    const { lines: found } = lines(p.rgba);
    expect(found).toHaveLength(2);
  });

  it('finds nothing on a blank page', () => {
    expect(lines(photo().rgba).lines).toEqual([]);
  });

  it('caps the number of lines', () => {
    const p = photo();
    // Lines spaced like writing on ruled paper, not stacked letter-for-letter.
    for (let row = 0; row < 6; row++) p.word(200 + (row % 3) * 11, 80 + row * 60, 5);
    const ink = inkMask(toBrightness(p.rgba, W, H), W, H);
    expect(findLines(ink, W, H, { rgba: p.rgba, maxLines: 3 }).lines).toHaveLength(3);
  });
});

describe('lineImage', () => {
  const labels = new Int32Array(W * H);
  labels[10 * W + 10] = 7;
  labels[10 * W + 11] = 3;
  const line: TextLine = { x0: 5, y0: 5, x1: 15, y1: 15, components: [7] };
  const pixel = (rgb: Uint8ClampedArray, x: number, y: number) =>
    Array.from(rgb.subarray((y * 10 + x) * 3, (y * 10 + x) * 3 + 3));

  it("renders only the line's own marks, black on white", () => {
    const { rgb, width, height } = lineImage(labels, W, line);
    expect([width, height]).toEqual([10, 10]);
    expect(pixel(rgb, 5, 5)).toEqual([0, 0, 0]);
    expect(pixel(rgb, 6, 5)).toEqual([255, 255, 255]); // another line's mark
    expect(pixel(rgb, 0, 0)).toEqual([255, 255, 255]);
  });

  it("keeps the strokes' shading, with the paper around them made white", () => {
    const brightness = new Float32Array(W * H).fill(200);
    brightness[10 * W + 10] = 50;
    const { rgb } = lineImage(labels, W, line, brightness);
    expect(pixel(rgb, 5, 5)[0]).toBeCloseTo((50 / 200) * 255, 0);
    expect(pixel(rgb, 4, 4)).toEqual([255, 255, 255]); // next to the mark: paper, scaled to white
    expect(pixel(rgb, 0, 0)).toEqual([255, 255, 255]); // away from it: white
  });
});
