import { expect, test } from '@playwright/test';

test('launcher lists playable games and disables ones this device cannot run', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Braincade/ })).toBeVisible();

  const playable = page.locator('a.game-card[data-game-id="bridge-check"]');
  await expect(playable).toBeVisible();
  await expect(playable).toContainText('Bridge Check');

  const blocked = page.locator('.game-card.disabled[data-game-id="needs-camera"]');
  await expect(blocked).toContainText('Needs camera');
});

test('unknown game ids show a friendly page', async ({ page }) => {
  await page.goto('/#/play/does-not-exist');
  await expect(page.getByTestId('game-not-found')).toBeVisible();
});

test('the game frame explains itself when opened directly', async ({ page }) => {
  await page.goto('/play.html?game=bridge-check');
  await expect(page.getByRole('alert')).toContainText('Open this game from Braincade');
});

test('catalog.json publishes games and word lists for the mobile app', async ({ request }) => {
  const catalog = await (await request.get('/catalog.json')).json();
  expect(catalog.schemaVersion).toBe(1);
  expect(catalog.games.map((g: { id: string }) => g.id)).toContain('bridge-check');
  expect(catalog.wordLists.length).toBeGreaterThan(0);
});
