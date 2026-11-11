/**
 * Step 29 — the complete end-to-end scenario, through the UI alone.
 *
 * The workbook's scenario, step for step:
 *
 *   Open WeighingMS → Select B-24187 → Load Recipe →
 *   Blue RSPL → Confirm → Red RB → Confirm → Yellow RGB → Confirm →
 *   Sodium Sulphate → Confirm → Soda Ash → Confirm →
 *   Batch Complete → OrgaTEX Write-back → Ticket
 *
 * The suite drives the running product — the real API and the real SPA,
 * two processes — and touches the API only to read back what the UI did.
 * Every weight comes from the training scale, poured with the terminal's
 * own "Simulate dispense".
 */
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  API_URL,
  BATCH_ID,
} from './fixtures.js';

/** The recipe, in the MES's order — and the scale the RULE must pick. */
const SCENARIO = [
  { componentId: 'DYE-4471-B', name: 'Remazol Brill. Blue RSPL', scale: '3 kg precision', unit: 'g' },
  { componentId: 'DYE-2204-R', name: 'Remazol Red RB', scale: '3 kg precision', unit: 'g' },
  { componentId: 'DYE-4471-Y', name: 'Remazol Yellow RGB', scale: '3 kg precision', unit: 'g' },
  { componentId: 'AUX-0101', name: 'Sodium Sulphate', scale: '32 kg floor', unit: 'kg' },
  { componentId: 'AUX-0107', name: 'Soda Ash', scale: '32 kg floor', unit: 'kg' },
] as const;

test.use({
  viewport: { width: 1440, height: 1000 },
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
});

test('B-24187 is weighed end to end — batch, recipe, five components, write-back, ticket', async ({
  page,
  request,
  releaseBatch,
}) => {
  test.setTimeout(240_000);

  // The MES releases the batch — the station never does (BRD BR-03).
  await releaseBatch();

  await test.step('Open WeighingMS and sign in', async () => {
    await page.goto('/');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    await signInAtStation(page);
    await expect(page.getByTestId('operator-bar-name')).toHaveText('R. Karim');
    await toTheQueue(page);
  });

  await test.step('The batch queue comes from the API', async () => {
    await expect(page.getByTestId('batch-queue-screen')).toBeVisible();
    for (const batchId of ['B-24187', 'B-24188', 'B-24190', 'B-24191']) {
      await expect(page.getByTestId(`queue-row-${batchId}`)).toBeVisible();
    }
    await expect(page.getByTestId(`queue-row-${BATCH_ID}`)).toHaveAttribute(
      'data-selectable',
      'true',
    );
  });

  await test.step('Select B-24187 — the recipe is loaded and the station starts the weighing', async () => {
    const recipeLoaded = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/recipe/${BATCH_ID}`) && response.ok(),
    );
    const started = page.waitForResponse(
      (response) =>
        response.url().includes('/api/session/start') && response.ok(),
    );

    await page.getByTestId(`queue-row-${BATCH_ID}`).click();
    await recipeLoaded;
    await started;

    await expect(page.getByTestId('weigh-screen')).toBeVisible();
    await expect(page.getByTestId('top-bar-crumb')).toContainText(BATCH_ID);
    await expect(page.getByTestId('rail-count')).toContainText('0/5');
    // The five components, by the MES's names.
    for (const component of SCENARIO) {
      await expect(
        page.getByTestId(`rail-component-${component.componentId}`),
      ).toContainText(component.name);
    }
  });

  for (const [index, component] of SCENARIO.entries()) {
    await test.step(`${component.name} — weigh and confirm`, async () => {
      // THE STATION chose the component and the scale — the rule, not the
      // operator (FR-14, BRD BR-05).
      await expect(page.getByTestId('weigh-name')).toHaveText(component.name);
      await expect(page.getByTestId('weigh-scale')).toContainText(component.scale);
      await expect(
        page.getByTestId(`rail-component-${component.componentId}`),
      ).toHaveAttribute('data-state', 'ACTIVE');

      // Nothing on the platform yet — the confirm is refused, and says why.
      await expect(page.getByTestId('confirm-action')).toBeDisabled();
      await expect(page.getByTestId('confirm-reason')).not.toBeEmpty();

      await page.getByTestId('training-dispense').click();

      // Into tolerance — the zone is the API's, and all three agree.
      await expect(page.getByTestId('confirm-action')).toBeEnabled({
        timeout: 30_000,
      });
      await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'OK');
      await expect(page.getByTestId('live-readout')).toHaveAttribute('data-zone', 'OK');
      await expect(page.getByTestId('live-weight-unit')).toHaveText(component.unit);

      // The confirm — by touch, and by F1 for one of them: the same action.
      if (index === 2) {
        await page.keyboard.press('F1');
      } else {
        await page.getByTestId('confirm-action').click();
      }

      if (index < SCENARIO.length - 1) {
        await expect(
          page.getByTestId(`rail-component-${component.componentId}`),
        ).toHaveAttribute('data-state', 'DONE');
        await expect(page.getByTestId('rail-count')).toContainText(
          `${index + 1}/5`,
        );
      }
    });
  }

  await test.step('Batch complete — the consumption is written back to OrgaTEX', async () => {
    await expect(page.getByTestId('completion-screen')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('summary-batch-id')).toHaveText(BATCH_ID);
    await expect(page.getByTestId('summary-counts')).toContainText('5/5');
    await expect(page.getByTestId('summary-verdict')).toContainText('YES');
    await expect(page.getByTestId('summary-write-back')).toContainText('CONFIRMED');
    await expect(page.getByTestId('summary-release')).toContainText('JET-04');

    // READ BACK — the station's own record of the write-back.
    const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
      data: { operatorId: 'OP-002', secret: '7359' },
    });
    const { token } = await signIn.json();
    const summary = await request.get(`${API_URL}/api/batch/${BATCH_ID}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(summary.ok()).toBe(true);
    const body = await summary.json();
    expect(body.summary).toMatchObject({
      batchId: BATCH_ID,
      componentsWeighed: 5,
      componentCount: 5,
      allWithinTolerance: 'YES',
      writeBack: 'CONFIRMED',
      releasedForTransport: true,
    });
  });

  await test.step('The ticket — generated by the station, printed by the dummy printer', async () => {
    const ticket = page.getByTestId('ticket-preview');
    await expect(ticket).toBeVisible();
    await expect(page.getByTestId('ticket-batch')).toContainText(BATCH_ID);
    await expect(page.getByTestId('ticket-batch')).toContainText('SO-9931');
    await expect(page.getByTestId('ticket-batch')).toContainText('Teal 4C');
    await expect(page.getByTestId('ticket-operator')).toContainText('OP-001');
    for (const component of SCENARIO) {
      await expect(
        page.getByTestId(`ticket-line-${component.componentId}`),
      ).toBeVisible();
    }
    await expect(page.getByTestId('ticket-barcode')).toHaveAttribute(
      'data-value',
      BATCH_ID,
    );

    await page.getByTestId('print-action').click();
    await expect(page.getByTestId('print-job-state')).toHaveAttribute(
      'data-state',
      'DONE',
    );
    await expect(page.getByTestId('print-printed')).toBeVisible();
  });

  await test.step('Next batch — back to the queue', async () => {
    await page.keyboard.press('F3');
    await expect(page.getByTestId('batch-queue-screen')).toBeVisible();
  });
});
