import type { Page } from '@playwright/test';

/** Replace window.print in every frame so print requests are recorded instead of opening a dialog. */
export async function stubPrinting(page: Page) {
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as Window & { __printed?: string[] };
      top.__printed = [...(top.__printed ?? []), document.title];
    };
  });
}

export async function printedTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __printed?: string[] }).__printed ?? []);
}
