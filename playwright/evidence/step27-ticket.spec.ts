/**
 * Step 27 — Implement Ticket Generation (backfilled evidence).
 *
 * Batch complete → generate ticket → Dummy printer → print / preview. The
 * ticket is checked for the prototype's ten fields, and every call the
 * terminal makes to the ticket and printer API is captured as given.
 */
import { writeFileSync } from 'node:fs';
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

test('Step 27 — the ticket carries the prototype’s ten fields, and the Dummy printer prints it', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(240_000);
  await releaseBatch();

  // Every ticket and printer call the terminal makes, as given.
  const calls: { method: string; path: string; status: number; body: string }[] = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(API_URL).origin) return;
    if (!/^\/api\/(tickets|print-jobs|printer)/.test(url.pathname)) return;
    let body = '';
    try {
      body = JSON.stringify(await response.json(), null, 2);
    } catch {
      body = '(no JSON body)';
    }
    calls.push({ method: response.request().method(), path: url.pathname, status: response.status(), body });
  });

  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();
  for (let weighed = 1; weighed <= 5; weighed += 1) {
    await page.getByTestId('training-dispense').click();
    await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('confirm-action').click();
    await page.mouse.move(5, 5);
    if (weighed < 5) await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
  }
  await expect(page.getByTestId('completion-screen')).toBeVisible({ timeout: 30_000 });
  const ticket = page.getByTestId('ticket-preview');
  await expect(ticket).toBeVisible();

  // PRINT — through the Dummy printer.
  await page.getByTestId('print-action').click();
  await expect(page.getByTestId('print-job-state')).toHaveAttribute('data-state', 'DONE', { timeout: 30_000 });
  await page.mouse.move(5, 5);

  // THE PROTOTYPE'S TEN FIELDS, checked on the ticket.
  const text = (await ticket.innerText()).replace(/\s+/g, ' ');
  const lines = ['DYE-4471-B', 'DYE-2204-R', 'DYE-4471-Y', 'AUX-0101', 'AUX-0107'];
  const checks = [
    { field: 'Batch', ok: text.includes('B-24187'), shows: 'B-24187' },
    { field: 'Order', ok: text.includes('SO-9931'), shows: 'SO-9931' },
    { field: 'Machine', ok: text.includes('JET-04'), shows: 'JET-04' },
    { field: 'Shade', ok: text.includes('Teal 4C'), shows: 'Teal 4C' },
    { field: 'Date', ok: /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(await page.getByTestId('ticket-date').innerText()), shows: await page.getByTestId('ticket-date').innerText() },
    { field: 'Operator', ok: (await page.getByTestId('ticket-operator').innerText()).includes('OP-001'), shows: await page.getByTestId('ticket-operator').innerText() },
    { field: 'Components', ok: (await Promise.all(lines.map((id) => page.getByTestId(`ticket-line-${id}`).isVisible()))).every(Boolean), shows: `${lines.length} lines` },
    { field: 'Target', ok: text.includes('1240.0') && text.includes('24.000'), shows: 'per line (e.g. 1240.0, 24.000)' },
    { field: 'Actual', ok: /\d+\.\d+ g/.test(text) && /\d+\.\d+ kg/.test(text), shows: 'per line, with unit' },
    { field: 'Barcode', ok: (await page.getByTestId('ticket-barcode').getAttribute('data-value')) === 'B-24187', shows: 'Code 128 of B-24187' },
  ];
  for (const check of checks) expect(check.ok, check.field).toBe(true);

  // STEP-27-ticket.png — the ticket, with the print panel beside it.
  const box = await ticket.boundingBox();
  const panel = await page.getByTestId('print-panel').boundingBox();
  if (box === null || panel === null) throw new Error('layout not found');
  const shot = await page.screenshot({
    clip: { x: Math.min(box.x, panel.x) - 10, y: Math.min(box.y, panel.y) - 10,
      width: Math.max(box.x + box.width, panel.x + panel.width) - Math.min(box.x, panel.x) + 20,
      height: Math.max(box.y + box.height, panel.y + panel.height) - Math.min(box.y, panel.y) + 60 },
  });
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1500, height: 900 });
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 13px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
    .row { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; align-items: start; }
    img { width: 100%; border: 1px solid #253244; }
    table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #253244; padding: 6px 8px; text-align: left; }
    th { color: #9fb0c4; font-size: 11px; text-transform: uppercase; } .ok { color: #5fd08a; } .no { color: #ff6b6b; }
  </style></head><body>
    <h1>Weighing ticket — B-24187</h1>
    <div class="sub">Batch complete → generate ticket → Dummy printer → printed · Playwright, fresh product · backfilled evidence ${new Date().toISOString().slice(0, 10)}</div>
    <div class="row"><img src="data:image/png;base64,${shot.toString('base64')}">
      <table><thead><tr><th>Prototype field</th><th>On the ticket</th><th></th></tr></thead><tbody>
        ${checks.map((c) => `<tr><td>${escape(c.field)}</td><td>${escape(c.shows)}</td><td class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'}</td></tr>`).join('')}
      </tbody></table></div></body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-27-ticket.png', fullPage: true });

  // STEP-27-printer-api.png — the calls, as given, plus the printer's status.
  const status = await request.get(`${API_URL}/api/printer/status`, {
    headers: { Authorization: `Bearer ${(await (await request.post(`${API_URL}/api/identity/sign-in`, { data: { operatorId: 'OP-002', secret: '7359' } })).json()).token}` },
  });
  calls.push({ method: 'GET', path: '/api/printer/status', status: status.status(), body: JSON.stringify(await status.json(), null, 2) });
  const shown = calls.filter((c, i, all) => all.findIndex((d) => d.method === c.method && d.path === c.path) === i || c.method !== 'GET');
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 22px 26px; background: #0f1720; color: #e6edf5; font: 13px "Segoe UI", sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .card { background: #141d28; border: 1px solid #253244; padding: 10px 12px; }
    .cmd { color: #5fd08a; font: 13px Consolas, monospace; margin-bottom: 6px; }
    pre { margin: 0; font: 11.5px/1.4 Consolas, monospace; white-space: pre-wrap; max-height: 420px; overflow: hidden; }
  </style></head><body>
    <h1>Ticket and Dummy printer API</h1>
    <div class="sub">The terminal's calls, in order, as given · backfilled evidence ${new Date().toISOString().slice(0, 10)}</div>
    <div class="grid">${shown.map((c) => `<div class="card"><div class="cmd">${c.method} ${escape(c.path)} → ${c.status}</div><pre>${escape(c.body)}</pre></div>`).join('')}</div>
  </body></html>`);
  await sheet.screenshot({ path: 'evidence/STEP-27-printer-api.png', fullPage: true });
  await sheet.close();

  expect(calls.some((c) => c.method === 'POST' && c.path === '/api/tickets')).toBe(true);
  expect(calls.some((c) => c.method === 'POST' && /\/api\/tickets\/[^/]+\/print$/.test(c.path))).toBe(true);
  writeFileSync('evidence/STEP-27-ticket-fields.json', `${JSON.stringify(checks, null, 2)}\n`);
});
