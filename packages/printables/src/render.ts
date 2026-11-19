import {
  type PrintableBlock,
  type PrintableDocument,
  type PrintableDocumentInput,
  printableDocumentSchema,
} from './model';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Only inline images and https URLs are allowed; anything else is dropped. */
export function isSafeImageSrc(src: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src) || /^https:\/\//i.test(src);
}

const RULING_HEIGHT_MM = { primary: 22, wide: 14, narrow: 9 } as const;

function writingLine(ruling: keyof typeof RULING_HEIGHT_MM, content = ''): string {
  return `<div class="line line-${ruling}" style="height:${RULING_HEIGHT_MM[ruling]}mm">${content}</div>`;
}

function renderBlock(block: PrintableBlock): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case 'text':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'writing-lines': {
      const label = block.label ? `<p class="label">${escapeHtml(block.label)}</p>` : '';
      return `<section class="lines">${label}${writingLine(block.ruling).repeat(block.count)}</section>`;
    }
    case 'word-practice': {
      const rows = block.words
        .map(
          (word) =>
            `<div class="practice-row"><div class="model">${escapeHtml(word)}</div>${'<div class="slot"></div>'.repeat(block.repeats)}</div>`,
        )
        .join('');
      return `<section class="practice">${rows}</section>`;
    }
    case 'panel-grid': {
      const total = block.rows * block.cols;
      const cells = Array.from({ length: total }, (_, i) => {
        const content = block.cells?.[i];
        const bubble = block.bubble
          ? `<div class="bubble">${writingLine('narrow').repeat(2)}</div>`
          : '';
        const caption = block.caption ? `<div class="caption">${writingLine('narrow')}</div>` : '';
        const body = content ? `<div class="cell-text">${escapeHtml(content)}</div>` : '';
        return `<div class="panel">${bubble}${body}${caption}</div>`;
      }).join('');
      return `<section class="panels" style="grid-template-columns:repeat(${block.cols},1fr);grid-template-rows:repeat(${block.rows},1fr)">${cells}</section>`;
    }
    case 'letter-boxes': {
      const words = block.words
        .map((word) => {
          const boxes = word
            .map(
              (box) =>
                `<span class="box"><span class="letter">${escapeHtml(box.letter ?? '')}</span><span class="clue">${escapeHtml(box.clue ?? '')}</span></span>`,
            )
            .join('');
          return `<span class="word">${boxes}</span>`;
        })
        .join('');
      return `<section class="letter-boxes">${words}</section>`;
    }
    case 'graph-paper':
      return `<section class="graph" style="height:${block.heightMm}mm;background-size:${block.cellMm}mm ${block.cellMm}mm"></section>`;
    case 'image':
      if (!isSafeImageSrc(block.src)) return '';
      return `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" style="width:${block.widthPercent}%">`;
  }
}

const STYLES = `
*{box-sizing:border-box}
body{margin:0;font-family:"Comic Sans MS","Chalkboard SE","Segoe Print",system-ui,sans-serif;color:#111}
.page{padding:12mm;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
h1{font-size:22pt;margin:0 0 6mm}
h2{font-size:16pt;margin:4mm 0}
p{font-size:13pt;margin:0 0 4mm}
.label{font-weight:bold}
.line{border-bottom:0.4mm solid #333;position:relative}
.line-primary::after,.line-wide::after{content:"";position:absolute;left:0;right:0;top:50%;border-top:0.3mm dashed #999}
.practice-row{display:grid;grid-template-columns:38mm repeat(auto-fit,minmax(20mm,1fr));gap:3mm;align-items:end;margin-bottom:3mm}
.practice-row .model{font-size:16pt;font-weight:bold}
.practice-row .slot{height:14mm;border-bottom:0.4mm solid #333;position:relative}
.practice-row .slot::after{content:"";position:absolute;left:0;right:0;top:50%;border-top:0.3mm dashed #999}
.panels{display:grid;gap:4mm;height:230mm}
.panel{border:0.8mm solid #111;border-radius:2mm;position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:3mm}
.bubble{border:0.4mm solid #111;border-radius:50%/40%;padding:3mm 8mm;width:75%;background:#fff}
.caption{border:0.4mm solid #111;padding:1mm 3mm;background:#fff}
.cell-text{font-size:16pt;text-align:center;margin:auto}
.letter-boxes{display:flex;flex-wrap:wrap;gap:4mm 8mm}
.word{display:inline-flex;gap:1mm}
.box{display:inline-flex;flex-direction:column;align-items:center;width:10mm}
.box .letter{display:block;width:10mm;height:11mm;border:0.4mm solid #333;text-align:center;font-size:16pt;line-height:11mm}
.box .clue{font-size:9pt;min-height:4mm}
.graph{width:100%;background-image:linear-gradient(#9ab 0.2mm,transparent 0.2mm),linear-gradient(90deg,#9ab 0.2mm,transparent 0.2mm);border:0.3mm solid #9ab}
img{display:block;margin:0 auto 4mm}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

/**
 * Render a printable document to a standalone HTML page. Input is validated, so
 * this is safe to call with data that came from a game frame.
 */
export function renderPrintableHtml(input: PrintableDocumentInput | PrintableDocument): string {
  const doc = printableDocumentSchema.parse(input);
  const pages = doc.pages
    .map((page) => `<div class="page">${page.blocks.map(renderBlock).join('')}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>@page{size:${doc.paper} ${doc.orientation};margin:0}${STYLES}</style></head><body>${pages}</body></html>`;
}
