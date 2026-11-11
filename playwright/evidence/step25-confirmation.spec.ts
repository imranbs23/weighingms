/**
 * Step 25 — Implement Confirmation (backfilled evidence).
 *
 * Weight → tolerance evaluation → valid? NO: confirm disabled; YES: confirm
 * enabled. On confirmation the station records the weighing, and the
 * workbook's eight fields — actualWeight, operator, component, lot,
 * container, tare, scale, timestamp — are on the record itself (bolt 032).
 *
 * The transaction is the station's own confirm response, saved as given.
 */
import { writeFileSync } from 'node:fs';
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  BATCH_ID,
} from '../fixtures.js';

test.use({ viewport: { width: 1440, height: 1000 } });

test('Step 25 — confirm is enabled only when valid, and the record carries all eight fields', async ({
  page,
  releaseBatch,
}) => {
  await releaseBatch();
  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  // Prepare: the MES's lot arrives by itself; the container is scanned.
  await expect(page.getByTestId('weigh-meta')).toContainText('2026-0341');
  await page.getByTestId('prepare-container-input').fill('C-09');
  await page.getByTestId('prepare-container-input').press('Enter');
  await expect(page.getByTestId('weigh-meta')).toContainText('Tare 214');
  await page.mouse.move(5, 5);

  const crop = async () => {
    const top = await page.getByTestId('weigh-head').boundingBox();
    const bottom = await page.getByTestId('confirm-reason').boundingBox();
    if (top === null || bottom === null) throw new Error('layout not found');
    return page.screenshot({
      clip: { x: top.x - 4, y: top.y - 4, width: top.width + 8, height: bottom.y + bottom.height - top.y + 12 },
    });
  };

  // NOT VALID — nothing on the platform.
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  const invalid = await crop();
  const invalidReason = (await page.getByTestId('confirm-reason').innerText()).trim();

  // VALID — poured into tolerance.
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
  await page.mouse.move(5, 5);
  const valid = await crop();
  const validReason = (await page.getByTestId('confirm-reason').innerText()).trim();

  // CONFIRMED — the station's own response is the transaction.
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/session/confirm' && r.request().method() === 'POST',
  );
  await page.getByTestId('confirm-action').click();
  const confirmed = await response;
  expect(confirmed.status()).toBe(201);
  const body = (await confirmed.json()) as {
    record: {
      recordId: string; componentId: string; actualQuantity: string; unit: string;
      operatorId: string; lotNumber: string | null; containerId: string | null;
      tare: { weight: string; unit: string; source: string } | null;
      scaleId: string; scaleClass: string; weighedAt: string; zoneAtConfirm: string;
    };
  };
  const r = body.record;

  // THE WORKBOOK'S EIGHT FIELDS — every one present on the record.
  const fields = [
    { workbook: 'actualWeight', field: 'actualQuantity + unit', value: `${r.actualQuantity} ${r.unit}` },
    { workbook: 'operator', field: 'operatorId', value: r.operatorId },
    { workbook: 'component', field: 'componentId', value: r.componentId },
    { workbook: 'lot', field: 'lotNumber', value: r.lotNumber },
    { workbook: 'container', field: 'containerId', value: r.containerId },
    { workbook: 'tare', field: 'tare', value: r.tare === null ? null : `${r.tare.weight} ${r.tare.unit} (${r.tare.source})` },
    { workbook: 'scale', field: 'scaleId + scaleClass', value: `${r.scaleId} (${r.scaleClass})` },
    { workbook: 'timestamp', field: 'weighedAt', value: r.weighedAt },
  ];
  for (const entry of fields) {
    expect(entry.value, entry.workbook).not.toBeNull();
  }
  expect(r.componentId).toBe('DYE-4471-B');
  expect(r.lotNumber).toBe('2026-0341');
  expect(r.containerId).toBe('C-09');
  expect(r.tare?.source).toBe('CONTAINER_MASTER');
  expect(r.operatorId).toBe('OP-001');
  expect(r.scaleId).toBe('SCALE-A');

  writeFileSync(
    'evidence/STEP-25-transaction.json',
    `${JSON.stringify(
      {
        _evidence: {
          step: 25,
          captured: new Date().toISOString(),
          backfill: true,
          source: 'POST /api/session/confirm — the station\'s response, as given (Playwright, fresh product)',
          workbookFields: Object.fromEntries(fields.map((f) => [f.workbook, `record.${f.field}`])),
        },
        request: { method: 'POST', path: '/api/session/confirm', body: { componentId: r.componentId } },
        response: { status: confirmed.status(), body },
      },
      null,
      2,
    )}\n`,
  );

  // THE SHEET — the decision, then the record.
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1700, height: 900 });
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 14px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    figure { margin: 0; background: #141d28; border: 1px solid #253244; padding: 8px; } img { width: 100%; }
    h2 { font-size: 17px; margin: 0 0 6px; } .no { color: #ff6b6b; } .yes { color: #5fd08a; }
    .r { color: #9fb0c4; font-size: 13px; margin-top: 4px; }
    table { border-collapse: collapse; margin-top: 16px; width: 100%; }
    td, th { border-bottom: 1px solid #253244; padding: 6px 10px; text-align: left; }
    th { color: #9fb0c4; font-size: 11px; text-transform: uppercase; } td.m { font-family: Consolas, monospace; }
    .flow { font: 15px Consolas, monospace; color: #ffc857; margin: 0 0 12px; }
  </style></head><body>
    <h1>Confirmation — Remazol Brill. Blue RSPL, B-24187</h1>
    <div class="sub">Playwright on a fresh product · backfilled evidence ${new Date().toISOString().slice(0, 10)}</div>
    <div class="flow">weight → tolerance evaluation → valid?  NO → confirm disabled   ·   YES → confirm enabled → recorded</div>
    <div class="row">
      <figure><h2>Not valid → <span class="no">confirm disabled</span></h2><img src="${img(invalid)}"><div class="r">${escape(invalidReason)}</div></figure>
      <figure><h2>Valid → <span class="yes">confirm enabled</span></h2><img src="${img(valid)}"><div class="r">${escape(validReason)}</div></figure>
    </div>
    <table><thead><tr><th>Workbook field</th><th>On the record</th><th>Recorded value</th></tr></thead><tbody>
      ${fields.map((f) => `<tr><td>${escape(f.workbook)}</td><td class="m">record.${escape(f.field)}</td><td class="m">${escape(String(f.value))}</td></tr>`).join('')}
      <tr><td>(also)</td><td class="m">record.zoneAtConfirm · recordId</td><td class="m">${escape(r.zoneAtConfirm)} · ${escape(r.recordId)}</td></tr>
    </tbody></table>
    <div class="r">From the station's response to POST /api/session/confirm → ${confirmed.status()} (full body: STEP-25-transaction.json)</div>
  </body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-25-confirmation.png', fullPage: true });
  await sheet.close();
});
