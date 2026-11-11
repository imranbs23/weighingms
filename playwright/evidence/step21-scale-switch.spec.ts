/**
 * Step 21 — Connect the Scale API (backfilled evidence).
 *
 * The prototype switches scales between components: Yellow RGB on the 3 kg
 * precision scale (grams), Sodium Sulphate on the 32 kg floor scale (kg).
 * The STATION picks the scale (the rule, BRD BR-05) and the terminal
 * subscribes to that scale's weight stream, GET /api/scales/:id/weight.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  API_URL,
  BATCH_ID,
} from '../fixtures.js';

test.use({ viewport: { width: 1440, height: 1000 } });

async function pourAndConfirm(page: Page, weighed: number): Promise<void> {
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
}

/** The first event of a scale's weight stream, and its status. */
async function readScale(request: APIRequestContext, token: string, scaleId: string) {
  const status = await request.get(`${API_URL}/api/scales/${scaleId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // The weight is a stream (SSE) that never ends: read its first event only.
  const controller = new AbortController();
  const response = await fetch(`${API_URL}/api/scales/${scaleId}/weight`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  controller.abort();
  return {
    status: (await status.json()) as Record<string, unknown>,
    weightStatus: response.status,
    contentType: response.headers.get('content-type') ?? '',
    firstEvent: new TextDecoder().decode(value).trim(),
  };
}

test('Step 21 — the station switches Yellow RGB (3 kg precision) to Sodium Sulphate (32 kg floor)', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(180_000);
  await releaseBatch();

  // Every weight stream the terminal opens.
  const streams: { at: string; path: string }[] = [];
  let at = 'Blue RSPL, Red RB, Yellow RGB (the dyes)';
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/^\/api\/scales\/[^/]+\/weight$/.test(url.pathname)) {
      streams.push({ at, path: url.pathname });
    }
  });

  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  await pourAndConfirm(page, 1);
  await pourAndConfirm(page, 2);

  let yellow = Buffer.alloc(0);
  await test.step('Yellow RGB → 3 kg precision, grams', async () => {
    at = 'Yellow RGB';
    await expect(page.getByTestId('weigh-name')).toHaveText('Remazol Yellow RGB');
    await expect(page.getByTestId('weigh-scale')).toContainText('3 kg precision');
    await page.getByTestId('training-dispense').click();
    await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('live-weight-unit')).toHaveText('g');
    yellow = await page.screenshot({ fullPage: true });
  });

  let sulphate = Buffer.alloc(0);
  await test.step('Confirm → Sodium Sulphate → 32 kg floor, kilograms', async () => {
    at = 'Sodium Sulphate';
    await page.getByTestId('confirm-action').click();
    await expect(page.getByTestId('weigh-name')).toHaveText('Sodium Sulphate');
    await expect(page.getByTestId('weigh-scale')).toContainText('32 kg floor');
    await page.getByTestId('training-dispense').click();
    await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('live-weight-unit')).toHaveText('kg');
    sulphate = await page.screenshot({ fullPage: true });
  });

  await test.step('The terminal subscribed to each scale’s own weight stream', async () => {
    expect(streams.some((s) => s.path === '/api/scales/SCALE-A/weight')).toBe(true);
    expect(streams.some((s) => s.at === 'Sodium Sulphate' && s.path === '/api/scales/SCALE-B/weight')).toBe(true);
  });

  // THE TWO MOMENTS, side by side.
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 2000, height: 820 });
  const img = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 14px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    figure { margin: 0; } img { width: 100%; border: 1px solid #253244; }
    figcaption { margin: 8px 0 0; font-size: 15px; } b { color: #5fd08a; }
  </style></head><body>
    <h1>Scale switch — chosen by the station, not the operator</h1>
    <div class="sub">B-24187 · Playwright on a fresh product · backfilled evidence ${new Date().toISOString().slice(0, 10)}</div>
    <div class="row">
      <figure><img src="${img(yellow)}"><figcaption>Remazol Yellow RGB → <b>3 kg precision</b> (SCALE-A), grams</figcaption></figure>
      <figure><img src="${img(sulphate)}"><figcaption>Sodium Sulphate → <b>32 kg floor</b> (SCALE-B), kilograms</figcaption></figure>
    </div></body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-21-scale-switch.png', fullPage: true });

  // THE SCALE API — both scales, read directly.
  const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
    data: { operatorId: 'OP-002', secret: '7359' },
  });
  const { token } = (await signIn.json()) as { token: string };
  const scaleA = await readScale(request, token, 'SCALE-A');
  const scaleB = await readScale(request, token, 'SCALE-B');
  expect(scaleA.weightStatus).toBe(200);
  expect(scaleB.weightStatus).toBe(200);
  expect(scaleA.contentType).toContain('text/event-stream');

  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pick = (status: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        ['scaleId', 'label', 'class', 'capacity', 'resolution', 'unit', 'status', 'link', 'source'].map((key) => [key, status[key]]),
      ),
      null,
      2,
    );
  const card = (title: string, scale: Awaited<ReturnType<typeof readScale>>) => `
    <div class="card"><h2>${escape(title)}</h2>
      <div class="cmd">GET ${escape(API_URL)}/api/scales/${escape(String(scale.status['scaleId']))}/status → 200</div>
      <pre>${escape(pick(scale.status))}</pre>
      <div class="cmd">GET ${escape(API_URL)}/api/scales/${escape(String(scale.status['scaleId']))}/weight → ${scale.weightStatus} · ${escape(scale.contentType)}</div>
      <pre>${escape(scale.firstEvent.replace(/^data: (.*)$/m, (_m, json: string) => `data: ${JSON.stringify(JSON.parse(json), null, 2)}`))}</pre>
    </div>`;
  await sheet.setViewportSize({ width: 1500, height: 900 });
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 13px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 12px; }
    .note { border-left: 3px solid #ffc857; padding: 6px 12px; background: #1a2430; margin: 0 0 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: #141d28; border: 1px solid #253244; padding: 12px 14px; }
    h2 { font-size: 15px; margin: 0 0 8px; color: #ffc857; }
    .cmd { color: #5fd08a; font: 12px Consolas, monospace; margin: 8px 0 4px; }
    pre { background: #0b1118; border: 1px solid #253244; padding: 8px 10px; margin: 0; font: 11.5px/1.4 Consolas, monospace; white-space: pre-wrap; }
    table { border-collapse: collapse; margin-top: 14px; } td, th { border-bottom: 1px solid #253244; padding: 4px 10px; text-align: left; font: 12px Consolas, monospace; }
    th { color: #9fb0c4; font-family: "Segoe UI"; text-transform: uppercase; font-size: 11px; }
  </style></head><body>
    <h1>Dummy Scale API — the weight the terminal reads</h1>
    <div class="sub">workbook Step 21 · the approved contract: GET /api/scales/:scaleId/weight is a live stream (Server-Sent Events, ≥ 10 Hz)</div>
    <p class="note">The workbook's example is GET /api/scales/scale-3kg/weight; this contract names the scales SCALE-A (3 kg precision) and SCALE-B (32 kg floor). Both devices report in grams; the station converts a reading into the recipe's unit, so Sodium Sulphate is shown in kg. Backfilled evidence, ${new Date().toISOString().slice(0, 10)}.</p>
    <div class="row">${card('SCALE-A — 3 kg precision', scaleA)}${card('SCALE-B — 32 kg floor', scaleB)}</div>
    <table><thead><tr><th>Component active</th><th>Weight stream the terminal opened</th></tr></thead><tbody>
      ${streams.map((s) => `<tr><td>${escape(s.at)}</td><td>GET ${escape(s.path)}</td></tr>`).join('')}
    </tbody></table>
  </body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-21-scale-api.png', fullPage: true });
  await sheet.close();
});
