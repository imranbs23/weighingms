/**
 * Step 30 — the failure scenarios, against the running product.
 *
 * "A functional industrial application cannot only demonstrate success."
 * Each workbook scenario is one test, run IN ORDER through one batch:
 * B-24187 is the only batch with a recipe, so the scenarios that cannot
 * complete it come first, and the last one completes it with OrgaTEX and
 * the printer down — and recovers both.
 *
 * The failures are injected through the Dummy APIs' own training controls
 * (the scale's link, the Dummy MES's reachability, the dummy printer's
 * availability); everything else is the operator's UI. Every scenario saves
 * a screenshot to `evidence/STEP-30-failure-tests/`.
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

const OUT = 'evidence/STEP-30-failure-tests';

test.describe.configure({ mode: 'serial' });
test.use({
  viewport: { width: 1440, height: 1000 },
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
});

/** A second operator's token — for the training controls and read-backs. */
async function controlToken(request: APIRequestContext): Promise<string> {
  const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
    data: { operatorId: 'OP-002', secret: '7359' },
  });
  return (await signIn.json()).token as string;
}

async function control(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<void> {
  const token = await controlToken(request);
  const response = await request.post(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok(), `${path} → ${response.status()}`).toBe(true);
}

async function read(request: APIRequestContext, path: string): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const token = await controlToken(request);
  const response = await request.get(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status(), body: await response.json() };
}

/**
 * Sign in and open B-24187 for weighing.
 *
 * On sign-in the terminal reads the station's session and RESUMES a batch
 * in progress straight into the weigh view; only when there is none does
 * the operator select it from the queue. So the helper waits for that read
 * before deciding which it is.
 */
async function openBatch(page: Page): Promise<void> {
  await page.goto('/');
  const decided = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/session',
  );
  await signInAtStation(page);
  const session = (await (await decided).json()).session as {
    state: string;
  } | null;

  if (session !== null && session.state !== 'COMPLETE') {
    await expect(page.getByTestId('weigh-screen')).toBeVisible();
    return;
  }
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();
}

/** Pour the active component into tolerance and confirm it. */
async function pourAndConfirm(page: Page, weighed: number): Promise<void> {
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
}

test('Under tolerance — cannot confirm', async ({ page, releaseBatch }) => {
  await releaseBatch();
  await openBatch(page);

  // The platform is empty: the zone is UNDER, and the confirm says so.
  await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'UNDER');
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  await expect(page.getByTestId('confirm-reason')).toContainText('under tolerance');

  // F1 is not a back door.
  await page.keyboard.press('F1');
  await expect(page.getByTestId('rail-count')).toContainText('0/5');
  await page.screenshot({ path: `${OUT}/under-tolerance.png`, fullPage: true });
});

test('Invalid weight — a confirmation the station cannot accept is refused', async ({
  page,
  request,
}) => {
  await openBatch(page);
  const token = await controlToken(request);

  // A component that is not the active one — the station refuses it.
  const wrong = await request.post(`${API_URL}/api/session/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { componentId: 'AUX-0107' },
  });
  expect(wrong.status()).toBe(409);

  // A body that is not a confirmation at all.
  const malformed = await request.post(`${API_URL}/api/session/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { componentId: '' },
  });
  expect(malformed.status()).toBe(400);

  // And nothing was recorded.
  await expect(page.getByTestId('rail-count')).toContainText('0/5');
  await expect(page.getByTestId('rail-component-AUX-0107')).toHaveAttribute(
    'data-state',
    'PENDING',
  );
});

test('Over tolerance — cannot confirm; the surplus is shown', async ({ page, request }) => {
  await openBatch(page);

  await page.getByTestId('training-overshoot').click();
  await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'OVER', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  await expect(page.getByTestId('confirm-reason')).toContainText('over tolerance');
  await expect(page.getByTestId('surplus-panel')).toBeVisible({ timeout: 15_000 });

  // F1 does nothing, and the API refuses it too.
  await page.keyboard.press('F1');
  const token = await controlToken(request);
  const refused = await request.post(`${API_URL}/api/session/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { componentId: 'DYE-4471-B' },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).reason).toBe('ZONE_OVER');
  await expect(page.getByTestId('rail-count')).toContainText('0/5');
  await page.screenshot({ path: `${OUT}/over-tolerance.png`, fullPage: true });
});

test('Re-tare — the weight is reset', async ({ page }) => {
  await openBatch(page);
  // Still over from the previous scenario.
  await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'OVER', {
    timeout: 15_000,
  });

  await page.keyboard.press('F2');

  await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'UNDER', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('live-weight-value')).toContainText('0.0');
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  await page.screenshot({ path: `${OUT}/re-tare.png`, fullPage: true });

  // And the component is weighed again from zero, in tolerance.
  await pourAndConfirm(page, 1);
});

test('Scale unavailable — safe failure: no reading is shown and nothing can be confirmed', async ({
  page,
  request,
}) => {
  await openBatch(page);
  await expect(page.getByTestId('weigh-name')).toHaveText('Remazol Red RB');

  await control(request, '/api/scales/SCALE-A/link', { state: 'DISCONNECTED' });

  // No weight is shown as live — never a stale number, never a zero.
  await expect(page.getByTestId('live-weight-value')).not.toContainText(/\d/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('confirm-action')).toBeDisabled();
  await expect(page.getByTestId('peripheral-SCALE-A')).toHaveAttribute(
    'data-healthy',
    'false',
    { timeout: 15_000 },
  );
  await page.screenshot({ path: `${OUT}/scale-unavailable.png`, fullPage: true });

  // RECOVERY — the scale comes back and the weighing continues.
  await control(request, '/api/scales/SCALE-A/link', { state: 'CONNECTED' });
  await expect(page.getByTestId('peripheral-SCALE-A')).toHaveAttribute(
    'data-healthy',
    'true',
    { timeout: 15_000 },
  );
  await pourAndConfirm(page, 2);
});

test('Quit — safe exit: the component is not recorded, and the batch resumes', async ({
  page,
}) => {
  await openBatch(page);
  await expect(page.getByTestId('weigh-name')).toHaveText('Remazol Yellow RGB');

  await page.keyboard.press('F4');
  await expect(page.getByTestId('batch-queue-screen')).toBeVisible();
  await page.screenshot({ path: `${OUT}/quit.png`, fullPage: true });

  // Back in: the same batch, the same component, nothing lost or added.
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-name')).toHaveText('Remazol Yellow RGB');
  await expect(page.getByTestId('rail-count')).toContainText('2/5');
  await expect(page.getByTestId('rail-component-DYE-4471-Y')).toHaveAttribute(
    'data-state',
    'ACTIVE',
  );
});

test('Incomplete batch — cannot complete', async ({ page, request }) => {
  await openBatch(page);
  await expect(page.getByTestId('rail-count')).toContainText('2/5');

  const token = await controlToken(request);
  const complete = await request.post(`${API_URL}/api/batch/${BATCH_ID}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(complete.status()).toBe(409);
  expect((await complete.json()).error).toBe('BATCH_NOT_COMPLETE');

  const summary = await read(request, `/api/batch/${BATCH_ID}/summary`);
  expect(summary.body['summary']).toBeNull();

  // The terminal resumes the weigh view — there is no completion to show.
  await openBatch(page);
  await expect(page.getByTestId('rail-count')).toContainText('2/5');
  await expect(page.getByTestId('completion-screen')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/incomplete-batch.png`, fullPage: true });
});

test('OrgaTEX and printer unavailable — weighing completes; the write-back is queued, the print fails, both recover', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openBatch(page);

  // ── OrgaTEX goes down mid-batch ───────────────────────────────────────
  await control(request, '/api/orgatex/control', { state: 'UNREACHABLE' });

  // The weighing does NOT stop: the last three components are weighed.
  await pourAndConfirm(page, 3);
  await pourAndConfirm(page, 4);
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });

  // The printer is out of paper before the batch completes.
  await control(request, '/api/printer/control', {
    available: false,
    reason: 'Out of paper',
  });
  await page.getByTestId('confirm-action').click();

  // The batch is complete — and the write-back is NOT claimed as done.
  await expect(page.getByTestId('completion-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('summary-counts')).toContainText('5/5');
  await expect(page.getByTestId('summary-write-back')).not.toContainText('CONFIRMED');
  await expect(page.getByTestId('peripheral-PRINTER')).toHaveAttribute(
    'data-healthy',
    'false',
    { timeout: 15_000 },
  );
  await page.screenshot({ path: `${OUT}/orgatex-unavailable.png`, fullPage: true });

  // ── The print fails — and the weighing survives ───────────────────────
  await page.getByTestId('print-action').click();
  await expect(page.getByTestId('print-job-state')).toHaveAttribute('data-state', 'FAILED');
  await expect(page.getByTestId('print-job-error')).toContainText('Out of paper');
  await expect(page.getByTestId('print-printed')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/printer-unavailable.png`, fullPage: true });
  const afterFailure = await read(request, `/api/batch/${BATCH_ID}/summary`);
  expect(afterFailure.body['summary']).toMatchObject({ componentsWeighed: 5 });

  // ── Recovery: the printer, then OrgaTEX ───────────────────────────────
  await control(request, '/api/printer/control', { available: true });
  await page.getByTestId('print-action').click();
  await expect(page.getByTestId('print-job-state')).toHaveAttribute('data-state', 'DONE');
  await expect(page.getByTestId('print-printed')).toBeVisible();

  await control(request, '/api/orgatex/control', { state: 'REACHABLE' });
  await expect
    .poll(
      async () =>
        ((await read(request, `/api/batch/${BATCH_ID}/summary`)).body['summary'] as {
          writeBack: string;
        }).writeBack,
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('CONFIRMED');
  // A reload signs the terminal out (the token is in memory); signing back
  // in reopens the completed batch — now written to OrgaTEX.
  await page.reload();
  await signInAtStation(page);
  await expect(page.getByTestId('summary-write-back')).toContainText('CONFIRMED', {
    timeout: 15_000,
  });
  await page.screenshot({ path: `${OUT}/orgatex-recovered.png`, fullPage: true });
});
