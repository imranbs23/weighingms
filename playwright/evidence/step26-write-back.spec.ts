/**
 * Step 26 — Implement OrgaTEX Write-back (backfilled evidence).
 *
 * 5/5 → Complete Batch → the consumption is posted to the Dummy OrgaTEX.
 *
 * The STATION posts in process, through the adapter (ADR-041): the browser
 * calls POST /api/batch/B-24187/complete, and the station posts each
 * component's consumption into the Dummy OrgaTEX. The Dummy's own HTTP
 * endpoint, POST /api/batches/:batchId/consumption, is shown separately on
 * another batch (B-24188), so B-24187's stored data stays exactly what the
 * station posted. The stored data is read back with GET (bolt 033).
 */
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

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const STYLE = `
  body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 13px "Segoe UI", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 12px; }
  .note { border-left: 3px solid #ffc857; padding: 6px 12px; background: #1a2430; margin: 0 0 14px; }
  h2 { font-size: 15px; margin: 16px 0 6px; color: #ffc857; }
  .cmd { color: #5fd08a; font: 13px Consolas, monospace; margin: 0 0 4px; }
  pre { background: #0b1118; border: 1px solid #253244; padding: 10px 12px; margin: 0; font: 12px/1.45 Consolas, monospace; white-space: pre-wrap; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #253244; padding: 5px 8px; text-align: left; font: 12px Consolas, monospace; }
  th { color: #9fb0c4; font: 600 11px "Segoe UI"; text-transform: uppercase; }`;

async function sheet(page: Page, file: string, body: string, height = 900): Promise<void> {
  const tab = await page.context().newPage();
  await tab.setViewportSize({ width: 1500, height });
  await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`);
  await tab.screenshot({ path: file, fullPage: true });
  await tab.close();
}

test('Step 26 — 5/5 → Complete Batch → consumption posted to the Dummy OrgaTEX, CONFIRMED, and stored', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(240_000);
  const today = new Date().toISOString().slice(0, 10);
  await releaseBatch();
  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  // FIVE COMPONENTS — the last confirm completes the batch.
  const completeCall = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/batch/${BATCH_ID}/complete` && r.request().method() === 'POST',
    { timeout: 200_000 },
  );
  for (let weighed = 1; weighed <= 5; weighed += 1) {
    await page.getByTestId('training-dispense').click();
    await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('confirm-action').click();
    await page.mouse.move(5, 5);
    if (weighed < 5) await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
  }
  const complete = await completeCall;
  const completeBody = (await complete.json()) as { summary: Record<string, unknown> };
  expect(complete.status()).toBe(200);
  expect(completeBody.summary['writeBack']).toBe('CONFIRMED');

  // 1. THE UI — "Written to OrgaTEX · CONFIRMED".
  await expect(page.getByTestId('completion-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('summary-write-back')).toContainText('CONFIRMED');
  await page.getByTestId('summary-write-back').evaluate((element) => {
    (element as HTMLElement).style.outline = '3px solid #ffc857';
    (element as HTMLElement).style.outlineOffset = '2px';
  });
  await page.screenshot({ path: 'evidence/STEP-26-ui.png', fullPage: true });

  // 4. THE STORED DATA — what the Dummy OrgaTEX holds for B-24187.
  const stored = await request.get(`${API_URL}/api/batches/${BATCH_ID}/consumption`);
  expect(stored.status()).toBe(200);
  const storedBody = (await stored.json()) as {
    batchId: string; receivedCount: number; postings: Record<string, string>[];
  };
  expect(storedBody.receivedCount).toBe(5);

  // The Dummy's own HTTP endpoint, exercised on ANOTHER batch.
  const direct = {
    batchId: 'B-24188',
    componentId: 'DYE-4471-B',
    actualQuantity: '1241.5000',
    unit: 'g',
    lotNumber: '2026-0341',
    operatorId: 'OP-001',
    weighedAt: new Date().toISOString(),
    idempotencyKey: 'STEP-26-DIRECT-1',
  };
  const directResponse = await request.post(`${API_URL}/api/batches/B-24188/consumption`, { data: direct });
  const directBody = await directResponse.json();
  expect(directResponse.status()).toBe(201);

  // 2. THE REQUEST.
  await sheet(page, 'evidence/STEP-26-request.png', `
    <h1>OrgaTEX write-back — the request</h1>
    <div class="sub">workbook Step 26 · Playwright on a fresh product · backfilled evidence ${today}</div>
    <p class="note">On the last confirm the terminal calls <b>POST /api/batch/${BATCH_ID}/complete</b>; the station then posts each component's consumption to the Dummy OrgaTEX <b>through its adapter, in process</b> (ADR-041) — one posting per component, each with its own idempotency key. The postings below are those the Dummy received, read back as received. The Dummy's HTTP form of the same call, <b>POST /api/batches/:batchId/consumption</b>, is shown on the right on another batch.</p>
    <div class="row"><div>
      <h2>1 · The terminal</h2>
      <div class="cmd">POST ${escape(API_URL)}/api/batch/${BATCH_ID}/complete</div>
      <pre>(no body — the station completes the batch it holds)</pre>
      <h2>2 · The station → Dummy OrgaTEX (in process), ${storedBody.receivedCount} postings</h2>
      <pre>${escape(JSON.stringify(storedBody.postings, null, 2))}</pre>
    </div><div>
      <h2>The Dummy's HTTP endpoint (B-24188)</h2>
      <div class="cmd">POST ${escape(API_URL)}/api/batches/B-24188/consumption</div>
      <pre>${escape(JSON.stringify(direct, null, 2))}</pre>
    </div></div>`, 1000);

  // 3. THE RESPONSE.
  await sheet(page, 'evidence/STEP-26-response.png', `
    <h1>OrgaTEX write-back — the response</h1>
    <div class="sub">workbook Step 26 · backfilled evidence ${today}</div>
    <p class="note">The completion answers <b>200 OK</b> with the station's summary: writeBack <b>CONFIRMED</b>. The Dummy's HTTP consumption endpoint answers <b>201 Created</b> — a new record; the workbook names 200 OK for the overall call.</p>
    <div class="row"><div>
      <div class="cmd">POST /api/batch/${BATCH_ID}/complete → ${complete.status()} OK</div>
      <pre>${escape(JSON.stringify(completeBody, null, 2))}</pre>
    </div><div>
      <div class="cmd">POST /api/batches/B-24188/consumption → ${directResponse.status()} Created</div>
      <pre>${escape(JSON.stringify(directBody, null, 2))}</pre>
    </div></div>`);

  // 4. THE STORED DATA, rendered.
  await sheet(page, 'evidence/STEP-26-data.png', `
    <h1>OrgaTEX write-back — the stored consumption</h1>
    <div class="sub">workbook Step 26 · backfilled evidence ${today}</div>
    <p class="note"><b>GET /api/batches/${BATCH_ID}/consumption → ${stored.status()}</b> — what the Dummy OrgaTEX holds for the batch, every posting as received (bolt 033). A training contract, not a claim about the real OrgaTEX (A-01, Q-01).</p>
    <table><thead><tr><th>#</th><th>Component</th><th>Actual</th><th>Lot</th><th>Operator</th><th>Weighed at</th><th>Idempotency key</th></tr></thead><tbody>
      ${storedBody.postings.map((p, i) => `<tr><td>${i + 1}</td><td>${escape(p['componentId'] ?? '')}</td><td>${escape(`${p['actualQuantity']} ${p['unit']}`)}</td><td>${escape(p['lotNumber'] ?? '')}</td><td>${escape(p['operatorId'] ?? '')}</td><td>${escape(p['weighedAt'] ?? '')}</td><td>${escape(p['idempotencyKey'] ?? '')}</td></tr>`).join('')}
    </tbody></table>
    <h2>The response, as given</h2>
    <pre>${escape(JSON.stringify(storedBody, null, 2))}</pre>`, 1000);
});
