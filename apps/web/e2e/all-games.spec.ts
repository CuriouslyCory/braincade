import { expect, test } from '@playwright/test';

const WEB_CAPABILITIES = ['storage', 'speech', 'print'];

/**
 * Smoke test for every game in the catalog, including ones added later: each
 * must boot in the frame, report ready, and exit cleanly. New games get this
 * coverage without writing a test.
 */
test('every playable game boots and exits', async ({ page, request }) => {
  const catalog = (await (await request.get('/catalog.json')).json()) as {
    games: Array<{ id: string; status: string; requires: string[] }>;
  };
  const games = catalog.games.filter(
    (g) => g.status !== 'retired' && g.requires.every((c) => WEB_CAPABILITIES.includes(c)),
  );
  expect(games.length).toBeGreaterThan(0);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const game of games) {
    await test.step(game.id, async () => {
      await page.goto(`/#/play/${game.id}`);
      await expect(page.locator('.player')).toHaveAttribute('data-state', 'running');
      await page.getByRole('button', { name: 'Exit game' }).click();
      await expect(page).toHaveURL(/#\/$/);
    });
  }
  expect(errors).toEqual([]);
});
