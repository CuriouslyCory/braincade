import { describe, expect, it } from 'vitest';
import { printableDocumentSchema } from './model';
import { escapeHtml, isSafeImageSrc, renderPrintableHtml } from './render';

describe('renderPrintableHtml', () => {
  it('renders every block type into one page per document page', () => {
    const html = renderPrintableHtml({
      title: 'Rematch sheet',
      pages: [
        {
          blocks: [
            { type: 'heading', text: 'Rematch!' },
            { type: 'text', text: 'Write each word three times.' },
            { type: 'word-practice', words: ['because', 'separate'] },
            { type: 'writing-lines', count: 2, ruling: 'primary', label: 'Sentence' },
          ],
        },
        {
          blocks: [
            { type: 'panel-grid', rows: 2, cols: 2, bubble: true, caption: true },
            { type: 'letter-boxes', words: [[{ clue: '7' }, { clue: '3', letter: 'E' }]] },
            { type: 'graph-paper' },
          ],
        },
      ],
    });

    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html).toContain('<h1>Rematch!</h1>');
    expect(html.match(/class="practice-row"/g)).toHaveLength(2);
    expect(html.match(/class="slot"/g)).toHaveLength(6);
    expect(html.match(/class="panel"/g)).toHaveLength(4);
    expect(html.match(/class="box"/g)).toHaveLength(2);
    expect(html).toContain('class="graph"');
    expect(html).toContain('size:letter portrait');
  });

  it('escapes text so frame-supplied content cannot inject markup', () => {
    const html = renderPrintableHtml({
      title: '<script>alert(1)</script>',
      pages: [{ blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops images with unsafe sources', () => {
    const html = renderPrintableHtml({
      title: 'Images',
      pages: [
        {
          blocks: [
            { type: 'image', src: 'javascript:alert(1)', alt: 'bad' },
            { type: 'image', src: 'https://example.com/a.png', alt: 'good' },
          ],
        },
      ],
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it('rejects invalid documents', () => {
    expect(() => renderPrintableHtml({ title: 'Empty', pages: [] })).toThrow();
    expect(
      printableDocumentSchema.safeParse({
        title: 'x',
        pages: [{ blocks: [{ type: 'writing-lines', count: 500 }] }],
      }).success,
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('escapeHtml escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('isSafeImageSrc allows data images and https only', () => {
    expect(isSafeImageSrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeImageSrc('https://example.com/x.jpg')).toBe(true);
    expect(isSafeImageSrc('http://example.com/x.jpg')).toBe(false);
    expect(isSafeImageSrc('data:text/html;base64,AAAA')).toBe(false);
  });
});
