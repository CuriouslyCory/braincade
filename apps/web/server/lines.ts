// Find lines of handwriting in a photo of paper. TrOCR reads one line at a time and was
// trained on clean scans (dark ink on white), so the reader turns each line it finds here
// into a black-on-white crop. Pure functions over pixel arrays, so they test in Node.

export interface LineBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Luma of an RGBA buffer, one value (0-255) per pixel. */
export function toGray(rgba: Uint8Array, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * (rgba[4 * i] ?? 0) + 0.587 * (rgba[4 * i + 1] ?? 0) + 0.114 * (rgba[4 * i + 2] ?? 0);
  }
  return gray;
}

/**
 * Ink pixels (1) vs paper (0): darker than the local average by `contrast`, so uneven
 * lighting across a phone photo doesn't swallow faint pencil, and darker than `maxInk`,
 * so light ruled lines and paper texture stay paper.
 */
export function inkMask(
  gray: Float32Array,
  width: number,
  height: number,
  { window = 31, contrast = 0.12, maxInk = 160 } = {},
): Uint8Array {
  // Summed-area table: the mean over any window in constant time.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x] ?? 0;
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] ?? 0) + row;
    }
  }
  const r = window >> 1;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum =
        (sums[y1 * stride + x1] ?? 0) -
        (sums[y0 * stride + x1] ?? 0) -
        (sums[y1 * stride + x0] ?? 0) +
        (sums[y0 * stride + x0] ?? 0);
      const mean = sum / ((y1 - y0) * (x1 - x0));
      const value = gray[y * width + x] ?? 255;
      ink[y * width + x] = value < mean * (1 - contrast) && value < maxInk ? 1 : 0;
    }
  }
  return ink;
}

/**
 * Lines of writing, top to bottom: bands of rows with ink, merged across small gaps
 * (descenders, dots) and dropping bands too thin to be writing (ruled lines, specks).
 * Each box is padded and trimmed to the ink's horizontal extent.
 */
export function findLines(ink: Uint8Array, width: number, height: number, maxLines = 8): LineBox[] {
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) count += ink[y * width + x] ?? 0;
    rows[y] = count;
  }
  const rowThreshold = Math.max(3, 0.004 * width);
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height && (rows[y] ?? 0) > rowThreshold;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands.push([start, y]);
      start = -1;
    }
  }
  const merged: Array<[number, number]> = [];
  for (const band of bands) {
    const last = merged.at(-1);
    if (last && band[0] - last[1] < 0.025 * height + 6) last[1] = band[1];
    else merged.push([band[0], band[1]]);
  }
  return merged
    .filter(([a, b]) => b - a > 0.03 * height + 8)
    .slice(0, maxLines)
    .map(([a, b]) => {
      let x0 = width;
      let x1 = 0;
      for (let y = a; y < b; y++) {
        for (let x = 0; x < width; x++) {
          if (ink[y * width + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
      }
      // TrOCR reads best with a generous white margin around the line.
      const pad = Math.round((b - a) * 0.6);
      return {
        x0: Math.max(0, x0 - pad),
        y0: Math.max(0, a - pad),
        x1: Math.min(width, x1 + pad),
        y1: Math.min(height, b + pad),
      };
    });
}

/** A line as clean black ink on white RGB, the input TrOCR expects. */
export function lineImage(ink: Uint8Array, width: number, box: LineBox) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const rgb = new Uint8ClampedArray(w * h * 3).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink[(box.y0 + y) * width + box.x0 + x]) rgb.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return { rgb, width: w, height: h };
}
