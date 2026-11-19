import { expect, test } from '@playwright/test';
import { printedTitles, stubPrinting } from './helpers';

test('a game session uses every capability and is recorded for grown-ups', async ({ page }) => {
  await stubPrinting(page);

  await page.goto('/#/grown-ups');
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hey Sam!' })).toBeVisible();
  await page.locator('a.game-card[data-game-id="bridge-check"]').click();

  await expect(page.locator('.player')).toHaveAttribute('data-state', 'running');
  const game = page.frameLocator('[data-testid="game-frame"]').locator('#game');
  await expect(game).toHaveAttribute('data-checks', 'done');
  await expect(game).toHaveAttribute('data-learner', 'Sam');
  await expect(game).toHaveAttribute('data-visits', '1');
  await expect(game).toHaveAttribute('data-printed', 'yes');
  const words = JSON.parse((await game.getAttribute('data-words')) ?? '[]') as string[];
  expect(words).toHaveLength(3);
  expect(await printedTitles(page)).toEqual(['Fixture sheet']);

  // The game ends itself; the host records the session and returns to the launcher.
  await page
    .frameLocator('[data-testid="game-frame"]')
    .getByRole('button', { name: 'Finish' })
    .click();
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('/#/grown-ups');
  await expect(page.locator('.sessions li')).toHaveCount(1);
  await expect(page.locator('.sessions li').first()).toContainText('Bridge Check');
  await expect(page.locator('.sessions li').first()).toContainText('0/1 correct');
  const missedRow = page.locator('tr', { hasText: `${words[0]}x` });
  await expect(missedRow).toContainText('learning');

  await page.getByRole('button', { name: /Print rematch sheet \(1 missed/ }).click();
  // Hash navigation keeps the same document, so the game's print is still recorded.
  await expect.poll(() => printedTitles(page)).toEqual(['Fixture sheet', 'Rematch sheet']);
});

test('exiting from the host lets the game clean up and keeps game storage', async ({ page }) => {
  await page.goto('/#/play/bridge-check');
  const game = page.frameLocator('[data-testid="game-frame"]').locator('#game');
  await expect(game).toHaveAttribute('data-checks', 'done');

  await page.getByRole('button', { name: 'Exit game' }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect(await page.evaluate(() => localStorage.getItem('bridge-check:cleaned-up'))).toBe('yes');

  await page.goto('/#/play/bridge-check');
  await expect(game).toHaveAttribute('data-visits', '2');
});
