import { expect, type Page, test } from '@playwright/test';

/** An 8×8 white PNG standing in for a photo of the learner's writing. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC',
  'base64',
);

type Reading = { words: Array<{ text: string; legible: boolean }> };

/**
 * Stand in for the server's handwriting reader: the probe says it is available, and each
 * POST answers with whatever `reply` builds from the photo it was sent.
 */
async function mockHandwriting(page: Page, reply: () => Reading) {
  const images: string[] = [];
  await page.route('**/api/handwriting', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { available: true } });
      return;
    }
    images.push((request.postDataJSON() as { image: string }).image);
    await route.fulfill({ json: reply() });
  });
  return images;
}

test('a learner copies silly sentences and the robot reads them back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // The robot reads every word, except that it can't make out the second one.
  let sentence = '';
  const images = await mockHandwriting(page, () => ({
    words: sentence
      .split(/\s+/)
      .map((text, i) => ({ text: i === 1 ? 'xq' : text, legible: i !== 1 })),
  }));

  await page.goto('/#/play/robot-reader');
  await expect(page.locator('.player')).toHaveAttribute('data-state', 'running');
  const game = page.frameLocator('[data-testid="game-frame"]');
  await game.getByRole('button', { name: 'Start' }).click();

  for (let round = 1; round <= 3; round++) {
    await expect(game.getByTestId('sentence-progress')).toHaveText(`Sentence ${round} of 3`);
    sentence = (await game.getByTestId('prompt-sentence').textContent()) ?? '';
    expect(sentence.split(/\s+/).length).toBeGreaterThan(3);

    await game.getByRole('button', { name: 'Snap my writing' }).click();
    // The host owns the camera: its sheet opens over the player, outside the game frame.
    const sheet = page.getByTestId('camera-sheet');
    await expect(sheet).toContainText('Snap your sentence');
    await sheet
      .getByLabel('Upload a photo')
      .setInputFiles({ name: 'writing.png', mimeType: 'image/png', buffer: PHOTO });
    await expect(sheet).toHaveCount(0);

    const reading = game.getByTestId('robot-reading');
    await expect(reading.locator('.gibberish')).toHaveCount(1);
    await expect(reading.locator('.gibberish')).not.toHaveText('xq');
    await expect(
      game.locator('[data-testid="comparison"] li[data-status="unreadable"]'),
    ).toHaveCount(1);
    await game.getByRole('button', { name: round < 3 ? 'Next sentence' : 'See my score' }).click();
  }

  expect(images).toHaveLength(3);
  for (const image of images) expect(image).toMatch(/^data:image\/jpeg;base64,/);

  await expect(game.getByTestId('score-summary')).toContainText('You copied 3 sentences');
  await game.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('/#/grown-ups');
  await expect(page.locator('.sessions li').first()).toContainText('Robot Reader');
  await expect(page.locator('.sessions li').first()).toContainText('/3 correct');
  expect(errors).toEqual([]);
});

test('cancelling the camera returns to the sentence', async ({ page }) => {
  await mockHandwriting(page, () => ({ words: [] }));
  await page.goto('/#/play/robot-reader');
  const game = page.frameLocator('[data-testid="game-frame"]');
  await game.getByRole('button', { name: 'Start' }).click();
  await game.getByRole('button', { name: 'Snap my writing' }).click();
  await page.getByTestId('camera-sheet').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('camera-sheet')).toHaveCount(0);
  await expect(game.getByTestId('prompt-sentence')).toBeVisible();
});

test('the game needs the handwriting reader, which the static build does not have', async ({
  page,
}) => {
  await page.goto('/#/grown-ups');
  await page.getByLabel('Show draft games on the launcher').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/');
  await expect(page.locator('.game-card.disabled[data-game-id="robot-reader"]')).toContainText(
    'Needs handwriting',
  );
});
