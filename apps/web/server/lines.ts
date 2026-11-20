// Find lines of handwriting in a photo. TrOCR reads one line at a time and was trained on
// clean scans (dark ink on white), so the reader turns each line found here into a
// black-on-white crop holding only the writing. Photos are messy: the page is only part of
// the frame (a kitchen, a chair, the arm holding the page), and lined paper has ruled lines
// and a margin. So this keeps letter-sized marks, groups them into rows, and keeps the block
// of rows that looks like writing. Pure functions over pixel arrays, so they test in Node.

export interface LineBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A line of writing: its padded box and the ink components (by label) that make it up. */
export interface TextLine extends LineBox {
  components: number[];
}

export interface Component extends LineBox {
  label: number;
  area: number;
}

/**
 * Brightness as each pixel's brightest channel. Ink is dark in every channel, while ruled
 * lines (light blue), margins (red), and coloured paper are bright in at least one, so
 * they read as paper.
 */
export function toBrightness(rgba: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(rgba[4 * i] ?? 0, rgba[4 * i + 1] ?? 0, rgba[4 * i + 2] ?? 0);
  }
  return out;
}

/** Perceived brightness (luma) of each pixel. Blue or red pen is dark by this measure. */
export function toLuma(rgba: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      0.299 * (rgba[4 * i] ?? 0) + 0.587 * (rgba[4 * i + 1] ?? 0) + 0.114 * (rgba[4 * i + 2] ?? 0);
  }
  return out;
}

/**
 * Ink in a photo, by two tests, either of which marks ink:
 * - darker than the paper in every channel (pencil, black or grey pen), which leaves light
 *   blue rules, red margins, and coloured paper as paper;
 * - clearly darker than the paper overall and not red: blue pen, even bright gel pen. Light
 *   blue rules aren't dark enough, and a red margin is skipped by colour.
 */
export function photoInk(
  rgba: Uint8Array,
  width: number,
  height: number,
  { window = 31 } = {},
): Uint8Array {
  const neutral = inkMask(toBrightness(rgba, width, height), width, height, { window });
  const coloured = inkMask(toLuma(rgba, width, height), width, height, {
    window,
    contrast: 0.3,
    maxInk: 150,
  });
  for (let i = 0; i < neutral.length; i++) {
    if (!coloured[i] || neutral[i]) continue;
    const r = rgba[4 * i] ?? 0;
    const g = rgba[4 * i + 1] ?? 0;
    const b = rgba[4 * i + 2] ?? 0;
    if (r < g + 40 || r < b + 40) neutral[i] = 1; // not a red margin
  }
  return neutral;
}

/**
 * Ink pixels (1) vs paper (0): darker than the local average by `contrast`, so uneven
 * lighting across a photo doesn't swallow faint pencil, and darker than `maxInk`.
 */
export function inkMask(
  brightness: Float32Array,
  width: number,
  height: number,
  { window = 31, contrast = 0.2, maxInk = 170 } = {},
): Uint8Array {
  // Summed-area table: the mean over any window in constant time.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += brightness[y * width + x] ?? 0;
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
      const value = brightness[y * width + x] ?? 255;
      ink[y * width + x] = value < mean * (1 - contrast) && value < maxInk ? 1 : 0;
    }
  }
  return ink;
}

/**
 * Erase ruled lines and margins: ink that runs a long way in one direction but is only a
 * few pixels thick across it. Where a letter crosses a rule its stroke is thicker than the
 * rule across that direction, so letters survive. Returns a new mask.
 */
export function removeRules(ink: Uint8Array, width: number, height: number): Uint8Array {
  const thin = Math.max(3, Math.round(0.006 * Math.max(width, height)));
  // Photographed rules break up into dashes, so a run bridges small gaps.
  const bridge = Math.max(3, Math.round(0.003 * Math.max(width, height)));
  const erase = (mask: Uint8Array, horizontal: boolean, minRun: number) => {
    const along = horizontal ? width : height;
    const across = horizontal ? height : width;
    const at = (a: number, b: number) => (horizontal ? b * width + a : a * width + b);
    const out = mask.slice();
    for (let b = 0; b < across; b++) {
      for (let a = 0; a < along; ) {
        if (!mask[at(a, b)]) {
          a++;
          continue;
        }
        let end = a;
        let gap = 0;
        for (let k = a; k < along && gap <= bridge; k++) {
          if (mask[at(k, b)]) {
            end = k + 1;
            gap = 0;
          } else gap++;
        }
        if (end - a >= minRun) {
          for (let k = a; k < end; k++) {
            if (!mask[at(k, b)]) continue;
            // Thickness across the run at this point.
            let t = 1;
            for (let d = b - 1; d >= 0 && mask[at(k, d)] && t <= thin; d--) t++;
            for (let d = b + 1; d < across && mask[at(k, d)] && t <= thin; d++) t++;
            if (t <= thin) out[at(k, b)] = 0;
          }
        }
        a = end;
      }
    }
    return out;
  };
  // Rules and margins cross most of the page; a letter's longest stroke is far shorter.
  // Each pass works on the previous one's result, so where a margin crosses a rule (thick
  // in both directions) the second pass sees only what's left and erases it.
  const horizontal = (mask: Uint8Array) => erase(mask, true, Math.max(40, Math.round(0.1 * width)));
  const vertical = (mask: Uint8Array) =>
    erase(mask, false, Math.max(40, Math.round(0.25 * height)));
  return horizontal(vertical(horizontal(ink)));
}

/** Label 8-connected ink regions. Labels start at 1; 0 is paper. */
export function components(ink: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height);
  const found: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue;
    const label = found.length + 1;
    const c: Component = { label, area: 0, x0: width, y0: height, x1: 0, y1: 0 };
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % width;
      const y = (i - x) / width;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x + 1 > c.x1) c.x1 = x + 1;
      if (y + 1 > c.y1) c.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (ink[j] && !labels[j]) {
            labels[j] = label;
            stack.push(j);
          }
        }
      }
    }
    found.push(c);
  }
  return { labels, components: found };
}

interface Row {
  y0: number;
  y1: number;
  members: Component[];
}

const heightOf = (b: LineBox) => b.y1 - b.y0;
const widthOf = (b: LineBox) => b.x1 - b.x0;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

/** Group marks into rows: chain each mark to the neighbours just beside it that overlap it
 * vertically. Following the chain copes with slanted lines and with descenders (g, p, y)
 * that sit lower than their neighbours; a mark in the next line down doesn't overlap enough. */
function chainRows(letters: Component[], maxGap: number): Row[] {
  const parent = letters.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const byX = letters.map((c, i) => ({ c, i })).sort((a, b) => a.c.x0 - b.c.x0);
  for (let p = 0; p < byX.length; p++) {
    const { c: a, i } = byX[p] as { c: Component; i: number };
    for (let q = p + 1; q < byX.length; q++) {
      const { c: b, i: j } = byX[q] as { c: Component; i: number };
      if (b.x0 - a.x1 > maxGap) break;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const apart = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
      if (
        overlap >= 0.5 * Math.min(heightOf(a), heightOf(b)) &&
        apart < 0.6 * Math.max(heightOf(a), heightOf(b))
      ) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Component[]>();
  letters.forEach((c, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  });
  return [...groups.values()].map(segmentOf);
}

/** Writing is many marks of about the same height side by side; a drawing has lots of ink
 * but few letter-like marks. */
function letterCount(row: Row): number {
  const h = median(row.members.map(heightOf));
  return row.members.filter((c) => heightOf(c) >= 0.4 * h && heightOf(c) <= 2.5 * h).length;
}

/**
 * The page the writing is on, as a test for "is this point on the paper?". Starts from
 * the blank paper around `writing`, grows across neighbouring areas of the same even
 * colour (white, lined, or coloured paper alike), and stops at the page edge, shadows,
 * hands, and the room. The writing itself sits in holes inside the page, so holes count.
 */
export function pageArea(
  rgba: Uint8Array,
  ink: Uint8Array,
  width: number,
  height: number,
  writing: LineBox,
): (x: number, y: number) => boolean {
  const cell = Math.max(8, Math.round(Math.max(width, height) / 64));
  const cols = Math.ceil(width / cell);
  const rowsN = Math.ceil(height / cell);
  // Each cell's colour is its median, not its mean: a thin rule or margin line covers few of
  // a cell's pixels, so it doesn't change the median, and the page grows across it.
  const mean = new Float32Array(cols * rowsN * 3);
  const inked = new Uint8Array(cols * rowsN);
  const channel = [
    new Uint8Array(cell * cell),
    new Uint8Array(cell * cell),
    new Uint8Array(cell * cell),
  ];
  for (let cy = 0; cy < rowsN; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let n = 0;
      let dark = 0;
      for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y++) {
        for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x++) {
          const i = y * width + x;
          for (let ch = 0; ch < 3; ch++) (channel[ch] as Uint8Array)[n] = rgba[4 * i + ch] ?? 0;
          dark += ink[i] ?? 0;
          n++;
        }
      }
      const k = cy * cols + cx;
      for (let ch = 0; ch < 3; ch++) {
        const values = (channel[ch] as Uint8Array).subarray(0, n).sort();
        mean[k * 3 + ch] = values[n >> 1] ?? 0;
      }
      inked[k] = dark > 0.01 * n ? 1 : 0;
    }
  }
  const colour = (k: number) => [mean[k * 3] ?? 0, mean[k * 3 + 1] ?? 0, mean[k * 3 + 2] ?? 0];
  const distance = (a: number[], b: number[]) =>
    Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

  // Seeds: blank cells just around the writing.
  const margin = heightOf(writing);
  const seeds: number[] = [];
  for (let cy = 0; cy < rowsN; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * cell;
      const y = (cy + 0.5) * cell;
      const near =
        x >= writing.x0 - margin &&
        x <= writing.x1 + margin &&
        y >= writing.y0 - margin &&
        y <= writing.y1 + margin;
      if (near && !inked[cy * cols + cx]) seeds.push(cy * cols + cx);
    }
  }
  if (seeds.length === 0) return () => true;
  const paper = [0, 1, 2].map((ch) => median(seeds.map((k) => colour(k)[ch] ?? 0)));

  // Grow across even, paper-coloured cells; lighting may drift slowly across the page.
  const page = new Uint8Array(cols * rowsN);
  const queue = seeds.filter((k) => distance(colour(k), paper) < 60);
  for (const k of queue) page[k] = 1;
  while (queue.length) {
    const k = queue.pop() as number;
    const cx = k % cols;
    const cy = (k - cx) / cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rowsN) continue;
      const n = ny * cols + nx;
      if (page[n] || inked[n]) continue;
      if (distance(colour(n), colour(k)) < 30 && distance(colour(n), paper) < 70) {
        page[n] = 1;
        queue.push(n);
      }
    }
  }
  // Close small gaps (a ruled line, a speck) so the page surrounds its writing.
  const grown = page.slice();
  for (let k = 0; k < cols * rowsN; k++) {
    if (!page[k]) continue;
    const cx = k % cols;
    for (const n of [k - 1, k + 1, k - cols, k + cols]) {
      if (n < 0 || n >= cols * rowsN || Math.abs((n % cols) - cx) > 1) continue;
      grown[n] = 1;
    }
  }
  page.set(grown);
  // Holes in the page (where the writing is) are on the page: everything not reachable from
  // the photo's border without crossing the page.
  const outside = new Uint8Array(cols * rowsN);
  const edge: number[] = [];
  for (let k = 0; k < cols * rowsN; k++) {
    const cx = k % cols;
    const cy = (k - cx) / cols;
    if ((cx === 0 || cy === 0 || cx === cols - 1 || cy === rowsN - 1) && !page[k]) {
      outside[k] = 1;
      edge.push(k);
    }
  }
  while (edge.length) {
    const k = edge.pop() as number;
    const cx = k % cols;
    const cy = (k - cx) / cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rowsN) continue;
      const n = ny * cols + nx;
      if (!outside[n] && !page[n]) {
        outside[n] = 1;
        edge.push(n);
      }
    }
  }
  return (x, y) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(rowsN - 1, Math.max(0, Math.floor(y / cell)));
    return !outside[cy * cols + cx];
  };
}

const boxOf = (members: LineBox[]): LineBox => ({
  x0: Math.min(...members.map((c) => c.x0)),
  y0: Math.min(...members.map((c) => c.y0)),
  x1: Math.max(...members.map((c) => c.x1)),
  y1: Math.max(...members.map((c) => c.y1)),
});

/**
 * Lines of writing, top to bottom:
 * 1. Keep marks the size and shape of letters or words (not touching the photo's edge, not
 *    long rules or page edges, not solid shapes).
 * 2. Find the writing: the row with the most letter-like marks.
 * 3. With `rgba`, keep only marks on the page around it (see pageArea).
 * 4. Group into lines (allowing word gaps) and keep the block of lines around the writing.
 * Small marks (dots, commas) inside a kept line are added back, and each line is padded
 * with paper.
 */
export function findLines(
  ink: Uint8Array,
  width: number,
  height: number,
  { rgba, maxLines = 8 }: { rgba?: Uint8Array; maxLines?: number } = {},
): { labels: Int32Array; lines: TextLine[] } {
  const cleaned = removeRules(ink, width, height);
  const { labels, components: all } = components(cleaned, width, height);
  const minHeight = Math.max(6, 0.012 * height);
  const marks = all.filter(
    (c) =>
      c.x0 > 0 &&
      c.y0 > 0 &&
      c.x1 < width &&
      c.y1 < height &&
      heightOf(c) >= minHeight &&
      heightOf(c) <= 0.16 * height &&
      widthOf(c) <= 0.35 * width &&
      // Strokes are thin: a wide, tall mark that fills most of its box is a shape, not
      // writing. (A thin stroke like l or I fills its narrow box, so it's exempt.)
      (Math.min(widthOf(c), heightOf(c)) < 0.35 * Math.max(widthOf(c), heightOf(c)) ||
        c.area <= 0.7 * widthOf(c) * heightOf(c)),
  );
  if (marks.length === 0) return { labels, lines: [] };
  // Letters (or joined-up words) are about one size; much taller marks are clutter.
  const typical = median(marks.map(heightOf));
  // A piece of a broken margin line or page edge (dashed in the photo, so removeRules left
  // bits of it): the straight line carries on above and below it, in a narrow band around
  // the piece's centre (allowing a slight slant). Letters in the lines above and below only
  // cross such a narrow band here and there.
  const straightCoverage = (c: LineBox, direction: -1 | 1) => {
    const centre = (c.x0 + c.x1) / 2;
    const start = direction < 0 ? c.y0 - 1 : c.y1;
    let inked = 0;
    let rows = 0;
    for (let dy = 0; dy < 3 * typical; dy++) {
      const y = start + direction * dy;
      if (y < 0 || y >= height) break;
      rows++;
      const tolerance = 3 + 0.08 * dy;
      const x0 = Math.max(0, Math.floor(centre - tolerance));
      const x1 = Math.min(width - 1, Math.ceil(centre + tolerance));
      for (let x = x0; x <= x1; x++) {
        if (ink[y * width + x]) {
          inked++;
          break;
        }
      }
    }
    return rows ? inked / rows : 0;
  };
  const onLongVerticalLine = (c: LineBox) =>
    widthOf(c) < typical && straightCoverage(c, -1) > 0.4 && straightCoverage(c, 1) > 0.4;
  let letters = marks.filter(
    // Up to 5x: a y or g with a long looping tail is much taller than most letters.
    (c) => heightOf(c) >= 0.4 * typical && heightOf(c) <= 5 * typical && !onLongVerticalLine(c),
  );

  // Find the writing with tight chains (letters within words), then keep marks on its page.
  const tight = chainRows(letters, 2.5 * typical);
  // Every mark may turn out to be part of a margin or page edge: then there's no writing.
  if (tight.length === 0) return { labels, lines: [] };
  const seed = tight.reduce((best, s) => (letterCount(s) > letterCount(best) ? s : best));
  const onPage = rgba ? pageArea(rgba, cleaned, width, height, boxOf(seed.members)) : () => true;
  const centreOnPage = (c: LineBox) => onPage((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2);
  // Writing sits inside the page's margins; ragged bits of the page's own edge sit on it.
  // (Less room is needed above and below: a first line can start close to the top.)
  const reach = 1.5 * typical;
  const insidePage = (c: LineBox) =>
    centreOnPage(c) &&
    onPage(c.x0 - reach, (c.y0 + c.y1) / 2) &&
    onPage(c.x1 + reach, (c.y0 + c.y1) / 2) &&
    onPage((c.x0 + c.x1) / 2, c.y0 - reach / 2) &&
    onPage((c.x0 + c.x1) / 2, c.y1 + reach / 2);
  letters = letters.filter(insidePage);

  // Lines: chains allowing word gaps (a few letter heights).
  const segments = chainRows(letters, 5 * typical);
  if (segments.length === 0) return { labels, lines: [] };
  const anchor = segments.reduce((best, s) => (letterCount(s) > letterCount(best) ? s : best));
  const lineHeight = median(anchor.members.map(heightOf));
  // A whole line's height, ascenders and descenders included: lines of writing are about
  // this far apart, more on wide-ruled paper or with a line skipped.
  const rowHeight = heightOf(boxOf(anchor.members));

  // Other lines of the same writing: letters of a similar size, within a few line heights
  // of a line already kept (room for wide spacing or a skipped line), and overlapping its
  // width. Writing far down the page is something else.
  const block = [anchor];
  let { x0: left, x1: right } = boxOf(anchor.members);
  const candidates = segments.filter((s) => {
    if (s === anchor || letterCount(s) < 2) return false;
    const h = median(s.members.map(heightOf));
    return h >= 0.5 * lineHeight && h <= 2 * lineHeight;
  });
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of candidates) {
      if (block.includes(s)) continue;
      const box = boxOf(s.members);
      const overlap = Math.min(right, box.x1) - Math.max(left, box.x0);
      const near = block.some((b) => Math.max(b.y0 - s.y1, s.y0 - b.y1) < 3 * rowHeight);
      if (near && overlap > 0.3 * Math.min(right - left, widthOf(box))) {
        block.push(s);
        left = Math.min(left, box.x0);
        right = Math.max(right, box.x1);
        grew = true;
      }
    }
  }

  // Fold in fragments that belong to a kept line: a tall letter that didn't chain (an f or
  // a capital), a stroke split off a letter, or a second half of a line split where a
  // letter didn't chain. A fragment joins the line it overlaps most vertically.
  const kept = block.sort((a, b) => letterCount(b) - letterCount(a));
  const homeFor = (s: Row, lines: Row[]) => {
    const box = boxOf(s.members);
    let best: Row | undefined;
    let bestOverlap = 0.6 * heightOf(box);
    for (const line of lines) {
      const lb = boxOf(line.members);
      const overlap = Math.min(box.y1, lb.y1) - Math.max(box.y0, lb.y0);
      const beside = box.x0 >= lb.x0 - 3 * lineHeight && box.x1 <= lb.x1 + 3 * lineHeight;
      if (beside && overlap > bestOverlap) {
        best = line;
        bestOverlap = overlap;
      }
    }
    return best;
  };
  const join = (home: Row, s: Row) => {
    home.members.push(...s.members);
    home.y0 = Math.min(home.y0, s.y0);
    home.y1 = Math.max(home.y1, s.y1);
  };
  for (const s of segments.filter((s) => !kept.includes(s))) {
    const home = homeFor(s, kept);
    if (home) join(home, s);
  }
  for (let i = kept.length - 1; i > 0; i--) {
    const home = homeFor(kept[i] as Row, kept.slice(0, i));
    if (home) {
      join(home, kept[i] as Row);
      kept.splice(i, 1);
    }
  }

  const lines = kept
    .sort((a, b) => a.y0 - b.y0)
    .slice(0, maxLines)
    .map((row) => {
      // Add back small marks (dots, punctuation, accents) close to the line's letters.
      const core = boxOf(row.members);
      const extra = all.filter(
        (c) =>
          !letters.includes(c) &&
          heightOf(c) < minHeight &&
          widthOf(c) <= typical &&
          // Dots and commas are roundish; leftover bits of ruled lines are long and flat.
          widthOf(c) <= 1.5 * heightOf(c) &&
          c.y0 >= core.y0 - 0.6 * lineHeight &&
          c.y1 <= core.y1 + 0.3 * lineHeight &&
          // Within the letters or just after the last one (a full stop); nothing before
          // the first letter, where leftovers of a margin line sit.
          c.x0 >= core.x0 &&
          c.x1 <= core.x1 + lineHeight &&
          !onLongVerticalLine(c) &&
          insidePage(c),
      );
      const members = [...row.members, ...extra];
      const box = boxOf(members);
      // TrOCR reads best with a generous margin of paper around the line.
      const pad = Math.round(lineHeight * 0.6);
      return {
        x0: Math.max(0, box.x0 - pad),
        y0: Math.max(0, box.y0 - pad),
        x1: Math.min(width, box.x1 + pad),
        y1: Math.min(height, box.y1 + pad),
        components: members.map((c) => c.label),
      };
    });
  return { labels, lines };
}

function segmentOf(members: Component[]): Row {
  return {
    y0: Math.min(...members.map((c) => c.y0)),
    y1: Math.max(...members.map((c) => c.y1)),
    members,
  };
}

/** A line as clean black ink on white RGB (only its own marks), the input TrOCR expects. */
export function lineImage(labels: Int32Array, width: number, line: TextLine, rgba?: Uint8Array) {
  const w = line.x1 - line.x0;
  const h = line.y1 - line.y0;
  const keep = new Set(line.components);
  const kept = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < w &&
    y < h &&
    keep.has(labels[(line.y0 + y) * width + line.x0 + x] ?? 0);
  const rgb = new Uint8ClampedArray(w * h * 3).fill(255);
  const paint = (x: number, y: number, value: number) =>
    rgb.fill(value, (y * w + x) * 3, (y * w + x) * 3 + 3);
  if (!rgba) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (kept(x, y)) paint(x, y, 0);
    return { rgb, width: w, height: h };
  }
  // With the photo, keep the strokes' real shading (TrOCR was trained on greyscale scans,
  // and soft edges read better than hard black), scaled so the paper around them is white.
  // Two measures of brightness: overall (luma), where blue pen is dark, and the brightest
  // channel, where pale blue rules are light. A stroke takes the darker, the pixels around
  // it the lighter, so blue writing stays dark and a rule beside a letter stays pale.
  const at = (x: number, y: number) => 4 * ((line.y0 + y) * width + line.x0 + x);
  const luma = (i: number) =>
    0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
  const brightest = (i: number) => Math.max(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
  let lumaPaper = 0;
  let brightPaper = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (kept(x, y)) continue;
      lumaPaper += luma(at(x, y));
      brightPaper += brightest(at(x, y));
      count++;
    }
  }
  lumaPaper = count ? lumaPaper / count : 255;
  brightPaper = count ? brightPaper / count : 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) near = kept(x + dx, y + dy);
      }
      if (!near) continue;
      const a = (luma(at(x, y)) / lumaPaper) * 255;
      const b = (brightest(at(x, y)) / brightPaper) * 255;
      paint(x, y, Math.min(255, kept(x, y) ? Math.min(a, b) : Math.max(a, b)));
    }
  }
  return { rgb, width: w, height: h };
}
