import type { PrintCapability } from '@braincade/game-host';
import { renderPrintableHtml } from '@braincade/printables';

/** Print a worksheet through the browser print dialog using a hidden iframe. */
export function webPrinter(doc: Document = document): PrintCapability {
  return {
    print: (printable) =>
      new Promise((resolve, reject) => {
        const frame = doc.createElement('iframe');
        frame.title = printable.title;
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        frame.onload = () => {
          const win = frame.contentWindow;
          if (!win) {
            frame.remove();
            reject(new Error('Print frame failed to load'));
            return;
          }
          win.addEventListener('afterprint', () => frame.remove(), { once: true });
          win.focus();
          win.print();
          // print() blocks until the dialog closes in most browsers; clean up regardless.
          setTimeout(() => frame.remove(), 60_000);
          resolve();
        };
        frame.srcdoc = renderPrintableHtml(printable);
        doc.body.append(frame);
      }),
  };
}
