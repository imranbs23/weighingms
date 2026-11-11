/**
 * Step 23 — Implement Component Progression (backfilled evidence).
 *
 * ONE continuous recording: the five components in the recipe's order,
 * each one refused until its weight is valid, the batch refused while a
 * component is still open, then completed. A caption bar narrates it.
 */
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  API_URL,
  BATCH_ID,
} from '../fixtures.js';

test.use({
  viewport: { width: 1440, height: 1000 },
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
});

const ORDER = [
  { componentId: 'DYE-4471-B', name: 'Remazol Brill. Blue RSPL' },
  { componentId: 'DYE-2204-R', name: 'Remazol Red RB' },
  { componentId: 'DYE-4471-Y', name: 'Remazol Yellow RGB' },
  { componentId: 'AUX-0101', name: 'Sodium Sulphate' },
  { componentId: 'AUX-0107', name: 'Soda Ash' },
] as const;

/** A caption bar over the terminal, so the video narrates itself. */
async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    let bar = document.getElementById('evidence-caption');
    if (bar === null) {
      bar = document.createElement('div');
      bar.id = 'evidence-caption';
      bar.setAttribute(
        'style',
        'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:99999;' +
          'background:rgba(255,200,87,.96);color:#111;font:600 20px "Segoe UI",sans-serif;' +
          'padding:10px 22px;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:none;',
      );
      document.body.appendChild(bar);
    }
    bar.textContent = value;
  }, text);
  await page.waitForTimeout(1600);
}

test('Step 23 — the five components progress in order, each only when valid, and the batch only when all are done', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(300_000);
  await releaseBatch();
  const log: string[] = [];

  await signInAtStation(page);
  await toTheQueue(page);
  await caption(page, 'Step 23 · B-24187 · five components, in the recipe’s order');
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
    data: { operatorId: 'OP-002', secret: '7359' },
  });
  const { token } = (await signIn.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  for (const [index, component] of ORDER.entries()) {
    await test.step(`${index + 1}. ${component.name}`, async () => {
      await expect(page.getByTestId('weigh-name')).toHaveText(component.name);
      await expect(page.getByTestId(`rail-component-${component.componentId}`)).toHaveAttribute('data-state', 'ACTIVE');
      await page.mouse.move(5, 5);

      // NOT YET VALID — the confirm is disabled, and the station refuses it.
      await caption(page, `${index + 1}/5 · ${component.name} — empty platform: OK · Confirm is disabled`);
      await expect(page.getByTestId('confirm-action')).toBeDisabled();
      const refused = await request.post(`${API_URL}/api/session/confirm`, {
        headers: auth,
        data: { componentId: component.componentId },
      });
      expect(refused.status()).toBe(409);
      log.push(`${component.name}: before a valid weight → confirm disabled, API ${refused.status()} ${(await refused.json()).reason}`);

      // THE LAST COMPONENT IS STILL OPEN — the batch cannot complete.
      if (index === ORDER.length - 1) {
        const early = await request.post(`${API_URL}/api/batch/${BATCH_ID}/complete`, { headers: auth });
        expect(early.status()).toBe(409);
        expect((await early.json()).error).toBe('BATCH_NOT_COMPLETE');
        log.push(`Batch complete requested with 4/5 weighed → API 409 BATCH_NOT_COMPLETE`);
        await caption(page, '4/5 weighed · “complete the batch” is REFUSED by the station (409 BATCH_NOT_COMPLETE)');
      }

      await caption(page, `${index + 1}/5 · ${component.name} — pour into tolerance`);
      await page.getByTestId('training-dispense').click();
      await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
      await caption(page, `${index + 1}/5 · ${component.name} — within tolerance: OK · Confirm`);
      await page.getByTestId('confirm-action').click();
      await page.mouse.move(5, 5);
      log.push(`${component.name}: within tolerance → confirmed`);

      if (index < ORDER.length - 1) {
        await expect(page.getByTestId(`rail-component-${component.componentId}`)).toHaveAttribute('data-state', 'DONE');
        await expect(page.getByTestId('rail-count')).toContainText(`${index + 1}/5`);
        const next = ORDER[index + 1]!;
        await expect(page.getByTestId('weigh-name')).toHaveText(next.name);
        log.push(`  → the station advanced to ${next.name} (${index + 1}/5 weighed)`);
      }
    });
  }

  await test.step('All five done — the batch completes', async () => {
    await expect(page.getByTestId('completion-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('summary-counts')).toContainText('5/5');
    await caption(page, '5/5 weighed · the batch is complete and written back to OrgaTEX');
    await page.waitForTimeout(1500);
    log.push('All five weighed → batch complete (summary 5/5)');
  });

  const video = page.video();
  await page.close();
  await video?.saveAs('evidence/STEP-23-five-component-demo.webm');
  writeFileSync('evidence/STEP-23-progression-log.txt', `${log.join('\n')}\n`);
});
