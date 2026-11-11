/**
 * Step 22 — Implement Tolerance (backfilled evidence).
 *
 * Yellow RGB, 94.0 g ± 0.5 g: the band is 93.5 g → 94.5 g. The Dummy scale
 * is landed EXACTLY on each of the workbook's five weights (the ramp lands
 * on `target + tolerance × 0.4`, so a tolerance of 0 lands on the target
 * itself), and the terminal's confirm is checked at each.
 *
 * Only the refusals are sent to the API: an allowed confirm would record
 * the weighing and move on. The allowed side is covered by the unit test of
 * the gate (tests/unit/confirmation-gate.test.ts, "Step 22 table").
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

test.use({ viewport: { width: 1440, height: 1000 } });

const TABLE = [
  { case: 'Below tolerance', weight: '93.4', allowed: false },
  { case: 'Lower boundary', weight: '93.5', allowed: true },
  { case: 'Target', weight: '94.0', allowed: true },
  { case: 'Upper boundary', weight: '94.5', allowed: true },
  { case: 'Over', weight: '94.6', allowed: false },
] as const;

async function pourAndConfirm(page: Page, weighed: number): Promise<void> {
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
}

test('Step 22 — Yellow RGB 94.0 g ± 0.5 g: 93.4 no · 93.5 yes · 94.0 yes · 94.5 yes · 94.6 no', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(240_000);
  await releaseBatch();
  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();
  await pourAndConfirm(page, 1);
  await pourAndConfirm(page, 2);
  await expect(page.getByTestId('weigh-name')).toHaveText('Remazol Yellow RGB');
  await expect(page.getByTestId('tolerance-band-caption')).toContainText('93.5');
  await expect(page.getByTestId('tolerance-band-caption')).toContainText('94.5');

  const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
    data: { operatorId: 'OP-002', secret: '7359' },
  });
  const { token } = (await signIn.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  const results: {
    case: string; weight: string; expected: string; zone: string;
    confirmEnabled: boolean; reason: string; api: string; shot: Buffer;
  }[] = [];

  for (const row of TABLE) {
    await test.step(`${row.weight} g — ${row.case}`, async () => {
      const dispense = await request.post(`${API_URL}/api/scales/SCALE-A/dispense`, {
        headers: auth,
        data: { target: `${row.weight}000`, tolerance: '0.0000', landing: 'IN_TOLERANCE' },
      });
      expect(dispense.ok(), `dispense ${row.weight} → ${dispense.status()}`).toBe(true);

      // The station's own reading reaches the exact weight.
      let zone = '';
      await expect
        .poll(async () => {
          const response = await request.get(`${API_URL}/api/session/zone`, { headers: auth });
          const body = (await response.json()) as { zone: string; value: string };
          zone = body.zone;
          return Number(body.value).toFixed(1);
        }, { timeout: 30_000 })
        .toBe(row.weight);
      // The terminal shows it, and its confirm follows the API's zone.
      await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', zone, { timeout: 10_000 });
      const confirm = page.getByTestId('confirm-action');
      if (row.allowed) await expect(confirm).toBeEnabled();
      else await expect(confirm).toBeDisabled();

      // The pointer off the buttons, so each frame shows the resting state.
      await page.mouse.move(5, 5);

      let api = 'not sent (it would record the weighing)';
      if (!row.allowed) {
        const refused = await request.post(`${API_URL}/api/session/confirm`, {
          headers: auth,
          data: { componentId: 'DYE-4471-Y' },
        });
        const body = (await refused.json()) as { reason?: string };
        expect(refused.status()).toBe(409);
        api = `409 ${body.reason ?? ''}`;
      }

      results.push({
        case: row.case,
        weight: row.weight,
        expected: row.allowed ? 'can confirm' : 'cannot confirm',
        zone,
        confirmEnabled: await confirm.isEnabled(),
        reason: (await page.getByTestId('confirm-reason').innerText()).trim(),
        api,
        // The readout, the band, the status and the buttons — cropped, so
        // the weight and the confirm's state are legible in the sheet.
        shot: await (async () => {
          const top = await page.getByTestId('live-readout').boundingBox();
          const bottom = await page.getByTestId('confirm-reason').boundingBox();
          const left = await page.getByTestId('weigh-head').boundingBox();
          if (top === null || bottom === null || left === null) throw new Error('layout not found');
          return page.screenshot({
            clip: { x: left.x, y: top.y - 6, width: left.width, height: bottom.y + bottom.height - top.y + 12 },
          });
        })(),
      });
    });
  }

  // THE FIVE MOMENTS, in one image.
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1800, height: 900 });
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 13px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    figure { margin: 0; background: #141d28; border: 1px solid #253244; padding: 8px; }
    img { width: 100%; } h2 { font-size: 18px; margin: 0 0 6px; }
    .yes { color: #5fd08a; } .no { color: #ff6b6b; } .m { font: 13px Consolas, monospace; color: #9fb0c4; margin-top: 6px; }
  </style></head><body>
    <h1>Tolerance — Remazol Yellow RGB, 94.0 g ± 0.5 g → 93.5 g … 94.5 g</h1>
    <div class="sub">The Dummy scale landed exactly on each weight; the terminal's confirm follows the station's zone. Playwright, fresh product · backfilled evidence ${new Date().toISOString().slice(0, 10)}</div>
    <div class="grid">${results.map((r) => `<figure>
      <h2>${escape(r.weight)} g · ${escape(r.case)} → <span class="${r.confirmEnabled ? 'yes' : 'no'}">${r.confirmEnabled ? 'CAN confirm' : 'CANNOT confirm'}</span></h2>
      <img src="data:image/png;base64,${r.shot.toString('base64')}">
      <div class="m">zone ${escape(r.zone)} · API confirm: ${escape(r.api)}</div>
    </figure>`).join('')}</div></body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-22-tolerance-ui.png', fullPage: true });
  await sheet.close();

  writeFileSync(
    'evidence/STEP-22-tolerance-e2e.json',
    `${JSON.stringify(results.map(({ shot: _shot, ...rest }) => rest), null, 2)}\n`,
  );
  for (const r of results) {
    expect(r.confirmEnabled, `${r.weight} g`).toBe(TABLE.find((row) => row.weight === r.weight)!.allowed);
  }
});
