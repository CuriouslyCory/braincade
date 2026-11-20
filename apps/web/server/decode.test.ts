import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodePhoto } from './trocr';

describe('decodePhoto', () => {
  it('puts a transparent drawing on white paper so its strokes stay dark', async () => {
    // A 20×10 transparent PNG with one opaque black stroke, like an exported canvas.
    const rgba = Buffer.alloc(20 * 10 * 4); // all transparent black
    for (let y = 2; y < 8; y++) rgba.set([0, 0, 0, 255], (y * 20 + 10) * 4);
    const png = await sharp(rgba, { raw: { width: 20, height: 10, channels: 4 } })
      .png()
      .toBuffer();
    const { data, width } = await decodePhoto(png);
    const pixel = (x: number, y: number) =>
      Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3));
    expect(pixel(0, 0)).toEqual([255, 255, 255]);
    expect(pixel(10, 5)).toEqual([0, 0, 0]);
  });
});
