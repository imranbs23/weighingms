/**
 * Step 19 — Connect Batch Selection (backfilled evidence).
 *
 * The Select-batch screen gets its rows from the API, and selecting B-24187
 * loads that batch and its recipe from the API. No batch is hard-coded in
 * the client.
 *
 * The terminal calls the STATION's own endpoints, which read the Dummy
 * OrgaTEX through its adapter, in process (ADR-028):
 *
 *   workbook                          terminal calls
 *   GET /api/batches              ≈   GET /api/batch-queue
 *   GET /api/batches/B-24187      ≈   POST /api/selection { batchId }
 *   GET /api/batches/B-24187/recipe ≈ GET /api/recipe/B-24187
 *
 * So the spec also proves the rows ARE the Dummy OrgaTEX's: it compares
 * them with the MES's own GET /api/batches.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  API_URL,
  BATCH_ID,
} from '../fixtures.js';

const OUT = 'evidence';

interface Call {
  phase: string;
  method: string;
  path: string;
  status: number;
  body: string;
}

/** Every source file of the operator terminal. */
function clientSources(dir = 'src/007-weighingms-ui'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? clientSources(full)
      : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('Step 19 — the Select-batch screen reads the API, and selecting B-24187 loads it and its recipe', async ({
  page,
  request,
  releaseBatch,
}) => {
  await releaseBatch();

  const calls: Call[] = [];
  let phase = 'open the queue';
  page.on('response', async (response) => {
    const url = new URL(response.url());
    // The API's own requests only — the UI dev server also serves the
    // terminal's source modules under /api/*.ts.
    if (url.origin !== new URL(API_URL).origin || !url.pathname.startsWith('/api/')) return;
    if (url.pathname.includes('/weight')) return;
    let body = '';
    try {
      body = (await response.text())
        .replace(/"token":"[^"]+"/g, '"token":"<masked>"')
        .replace(/\s+/g, ' ')
        .slice(0, 150);
    } catch {
      body = '(stream)';
    }
    calls.push({
      phase,
      method: response.request().method(),
      path: url.pathname + url.search,
      status: response.status(),
      body,
    });
  });

  await test.step('The queue comes from the API', async () => {
    await signInAtStation(page);
    await toTheQueue(page);
    for (const id of ['B-24187', 'B-24188', 'B-24190', 'B-24191']) {
      await expect(page.getByTestId(`queue-row-${id}`)).toBeVisible();
    }
    await page.screenshot({ path: `${OUT}/STEP-19-batch-screen.png`, fullPage: true });
  });

  await test.step('The rows ARE the Dummy OrgaTEX’s — compared with its own GET /api/batches', async () => {
    const mes = await request.get(`${API_URL}/api/batches`);
    expect(mes.status()).toBe(200);
    const { batches } = (await mes.json()) as { batches: { batchId: string; orderRef: string }[] };
    for (const batch of batches) {
      const row = page.getByTestId(`queue-row-${batch.batchId}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(batch.orderRef);
    }
    expect(calls.some((call) => call.path.startsWith('/api/batch-queue') && call.status === 200)).toBe(true);
  });

  await test.step('Selecting B-24187 loads the batch and its recipe from the API', async () => {
    phase = 'select B-24187';
    const recipe = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/recipe/${BATCH_ID}`,
    );
    await page.getByTestId(`queue-row-${BATCH_ID}`).click();
    expect((await recipe).status()).toBe(200);
    await expect(page.getByTestId('weigh-screen')).toBeVisible();
    await expect(page.getByText('Remazol Brill. Blue RSPL').first()).toBeVisible();
  });

  await test.step('No batch is hard-coded in the client', async () => {
    for (const file of clientSources()) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/const\s+batches\s*=\s*\[/);
      expect(text, file).not.toMatch(/B-2418[78]|B-2419[01]|SO-9931/);
    }
  });

  await test.step('The network, rendered', async () => {
    const mapping: Record<string, string> = {
      '/api/batch-queue': '≈ workbook GET /api/batches — reads the Dummy OrgaTEX queue through the adapter (ADR-028)',
      '/api/selection': '≈ workbook GET /api/batches/B-24187 — the batch, as a recorded selection',
      [`/api/recipe/${BATCH_ID}`]: '= workbook GET /api/batches/B-24187/recipe, through the adapter',
      '/api/session/start': 'the station starts the weighing at the first component',
    };
    // The screen's own data calls only: the locale strings, the status
    // strip's device polls and the weigh view's zone poll are left out, and a
    // call repeated in one phase is shown once with its count.
    const noise = [
      '/api/locale', '/api/session/zone', '/api/orgatex/link-state', '/api/orgatex/sync-queue',
      '/api/scanner/status', '/api/printer/status', '/api/scales/', '/api/configuration',
    ];
    const seen = new Map<string, Call & { count: number; note: string }>();
    for (const call of calls) {
      if (noise.some((prefix) => call.path.startsWith(prefix))) continue;
      const id = `${call.phase}|${call.method}|${call.path}`;
      const existing = seen.get(id);
      if (existing !== undefined) {
        existing.count += 1;
        continue;
      }
      const key = Object.keys(mapping).find((prefix) => call.path.startsWith(prefix));
      seen.set(id, { ...call, count: 1, note: key === undefined ? '' : mapping[key] });
    }
    const rows = [...seen.values()];
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sheet = await page.context().newPage();
    await sheet.setViewportSize({ width: 1500, height: 900 });
    await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 26px 30px; background: #0f1720; color: #e6edf5; font: 13px/1.45 "Segoe UI", sans-serif; }
      h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #9fb0c4; margin-bottom: 14px; }
      .note { border-left: 3px solid #ffc857; padding: 6px 12px; background: #1a2430; margin: 0 0 14px; }
      table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #253244; padding: 5px 7px; text-align: left; vertical-align: top; }
      th { color: #9fb0c4; font-size: 11px; text-transform: uppercase; }
      .m { font-family: Consolas, monospace; } .b { font-family: Consolas, monospace; color: #9fb0c4; font-size: 11px; word-break: break-all; }
      .hl td { background: #15241c; } .ok { color: #5fd08a; }
    </style></head><body>
      <h1>Network — Select batch → B-24187</h1>
      <div class="sub">The terminal's /api data calls (Playwright, fresh database). Locale strings, device and link polls, zone polls and the weight stream are omitted; a repeated call is shown once with its count.</div>
      <p class="note">Backfilled evidence, ${new Date().toISOString().slice(0, 10)}. The terminal calls the station's endpoints, which read the Dummy OrgaTEX in process (ADR-028). The Dummy OrgaTEX's own GET /api/batches returned the same batches.</p>
      <table><thead><tr><th>Phase</th><th>Method</th><th>Path</th><th>Status</th><th>Workbook equivalent</th><th>Response (start)</th></tr></thead><tbody>
      ${rows.map((row) => `<tr class="${row.note ? 'hl' : ''}"><td>${escape(row.phase)}</td><td class="m">${row.method}</td><td class="m">${escape(row.path)}${row.count > 1 ? ` <span style="color:#9fb0c4">×${row.count}</span>` : ''}</td>
        <td class="${row.status < 300 ? 'ok' : ''}">${row.status}${row.status === 401 ? ' (before sign-in)' : ''}</td><td>${escape(row.note)}</td><td class="b">${escape(row.body)}</td></tr>`).join('')}
      </tbody></table></body></html>`);
    await sheet.screenshot({ path: `${OUT}/STEP-19-network.png`, fullPage: true });
    await sheet.close();
    expect(rows.some((row) => row.path === `/api/recipe/${BATCH_ID}`)).toBe(true);
  });
});
