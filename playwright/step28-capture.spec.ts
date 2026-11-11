/**
 * Step 28 — capture the prototype's three screens beside the working app's.
 *
 * The prototype is opened from `docs/`; the app is the real two-process
 * product the harness starts, driven through its own UI only — the batch is
 * selected by touch, every component is poured with the training scale's
 * own control and confirmed with the OK key.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, signInAtStation, BATCH_ID } from './fixtures.js';

const OUT = 'evidence/STEP-28-ui-validation';
const PROTOTYPE = pathToFileURL(
  resolve('docs/customize-weighing-station.html'),
).href;

test.use({ viewport: { width: 1440, height: 1000 } });

test('prototype — the three screens', async ({ page }) => {
  await page.goto(PROTOTYPE);
  for (const [view, file] of [
    ['queue', 'screen-1-prototype.png'],
    ['weigh', 'screen-2-prototype.png'],
    ['done', 'screen-3-prototype.png'],
  ] as const) {
    await page.locator(`button[data-view="${view}"]`).click();
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  }
});

test('app — the three screens, through the UI', async ({ page, releaseBatch }) => {
  test.setTimeout(240_000);
  await releaseBatch();

  await page.goto('/');
  await page.screenshot({ path: `${OUT}/app-0-sign-in.png`, fullPage: true });

  await signInAtStation(page);
  await expect(page.getByTestId(`queue-row-${BATCH_ID}`)).toBeVisible();
  await expect(page.getByTestId('peripheral-SCALE-A')).toHaveAttribute(
    'data-healthy',
    'true',
  );
  await page.screenshot({ path: `${OUT}/screen-1-app.png`, fullPage: true });

  // 1 · SELECT THE BATCH — by touch.
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  // 2 · WEIGH — all five, each poured with the training scale and confirmed.
  for (let index = 0; index < 5; index += 1) {
    await expect(page.getByTestId('training-dispense')).toBeVisible();
    await page.getByTestId('training-dispense').click();
    await expect(page.getByTestId('confirm-action')).toBeEnabled({
      timeout: 30_000,
    });
    if (index === 2) {
      // Yellow RGB, in tolerance on the 3 kg scale — the prototype's screen.
      await page.screenshot({ path: `${OUT}/screen-2-app.png`, fullPage: true });
    }
    if (index === 3) {
      await page.screenshot({
        path: `${OUT}/screen-2-app-32kg.png`,
        fullPage: true,
      });
    }
    await page.getByTestId('confirm-action').click();
    if (index < 4) {
      await expect(page.getByTestId('rail-count')).toContainText(
        `${index + 1}/5`,
      );
    }
  }

  // 3 · CONFIRM & PRINT — the station completed the batch.
  await expect(page.getByTestId('completion-screen')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('summary-write-back')).toContainText(
    'CONFIRMED',
  );
  await expect(page.getByTestId('ticket-preview')).toBeVisible();
  await page.getByTestId('print-action').click();
  await expect(page.getByTestId('print-job-state')).toBeVisible();
  await page.screenshot({ path: `${OUT}/screen-3-app.png`, fullPage: true });
});
