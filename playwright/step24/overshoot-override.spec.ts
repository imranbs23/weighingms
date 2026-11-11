/**
 * Step 24 — the overshoot rule, against the running product (bolt 030,
 * ADR-047).
 *
 * An over-tolerance component is never confirmed automatically. The
 * surplus is shown for information; a supervisor signs off at the terminal
 * with badge, PIN and reason; the weight is then confirmed AS POURED, and
 * the completion detail and the ticket mark it "OVER · overridden".
 *
 * A wrong PIN is refused first, so the refusal is seen on the same run.
 */
import {
  test,
  expect,
  signInAtStation,
  toTheQueue,
  API_URL,
  BATCH_ID,
  SUPERVISOR_ID,
  SUPERVISOR_SECRET,
} from '../fixtures.js';

const OUT = 'evidence';

test.use({
  viewport: { width: 1440, height: 1000 },
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
});

test('Over tolerance — supervisor override confirms the weight as poured, marked overridden', async ({
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

  await test.step('The pour lands OVER: never confirmed automatically', async () => {
    await page.getByTestId('training-overshoot').click();
    await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'OVER', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('confirm-action')).toBeDisabled();
    await page.keyboard.press('F1');
    await expect(page.getByTestId('rail-count')).toContainText('0/5');
  });

  await test.step('The surplus is shown FOR INFORMATION — no proposal', async () => {
    const panel = page.getByTestId('surplus-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('surplus-recovery')).toContainText('Re-tare and re-weigh');
    await expect(page.getByTestId('surplus-accept')).toHaveCount(0);
  });

  await test.step('A wrong PIN is refused, and confirm stays disabled', async () => {
    await page.getByTestId('override-action').click();
    await expect(page.getByTestId('escalation-panel')).toBeVisible();
    await expect(page.getByTestId('escalation-authorisation-id')).toHaveCount(0);

    await page.getByTestId('escalation-supervisor-id').fill(SUPERVISOR_ID);
    await page.getByTestId('escalation-secret').fill('0000');
    await page.getByTestId('escalation-reason').fill('Client accepts the stronger shade');
    await page.getByTestId('escalation-authorise').click();

    await expect(page.getByTestId('escalation-failure')).toContainText(
      'The authorisation was refused.',
    );
    await expect(page.getByTestId('escalation-secret')).toHaveValue('');
    await expect(page.getByTestId('confirm-action')).toBeDisabled();
  });

  await test.step('The supervisor signs off: confirm is enabled, and says why', async () => {
    await page.getByTestId('escalation-secret').fill(SUPERVISOR_SECRET);
    await page.getByTestId('escalation-authorise').click();

    await expect(page.getByTestId('escalation-authorised')).toContainText(SUPERVISOR_ID);
    await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('confirm-reason')).toContainText(
      'authorised by a supervisor',
    );
    await page.screenshot({ path: `${OUT}/STEP-24-overshoot-ui.png`, fullPage: true });
  });

  let poured = '';
  await test.step('Confirmed AS POURED, zone OVER', async () => {
    const confirmed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/session/confirm' &&
        response.request().method() === 'POST',
    );
    await page.keyboard.press('F1');
    const body = (await (await confirmed).json()) as {
      record: { zoneAtConfirm: string; actualQuantity: string; componentId: string };
    };
    expect(body.record.zoneAtConfirm).toBe('OVER');
    expect(body.record.componentId).toBe('DYE-4471-B');
    poured = body.record.actualQuantity;
    await expect(page.getByTestId('rail-count')).toContainText('1/5');
  });

  await test.step('The rest of the batch, in tolerance — no target was recalculated', async () => {
    for (const weighed of [2, 3, 4, 5]) {
      await page.getByTestId('training-dispense').click();
      await expect(page.getByTestId('confirm-action')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('confirm-action').click();
      if (weighed < 5) {
        await expect(page.getByTestId('rail-count')).toContainText(`${weighed}/5`);
      }
    }
    await expect(page.getByTestId('completion-screen')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Completion and ticket mark the component "OVER · overridden"', async () => {
    await expect(page.getByTestId('detail-zone-DYE-4471-B')).toHaveText('OVER · overridden');
    await expect(page.getByTestId('detail-zone-DYE-2204-R')).toHaveText('OK');
    await expect(page.getByTestId('ticket-overridden-DYE-4471-B')).toHaveText(
      'OVER · overridden',
    );
    await expect(page.getByTestId('ticket-outcome')).toContainText('OUT_OF_TOLERANCE');
    await page.screenshot({
      path: `${OUT}/STEP-24-overshoot-completion.png`,
      fullPage: true,
    });
  });

  await test.step('The supervisor’s report lists the OVER weighing, as poured', async () => {
    const signIn = await request.post(`${API_URL}/api/identity/sign-in`, {
      data: { operatorId: SUPERVISOR_ID, secret: SUPERVISOR_SECRET },
    });
    const { token } = (await signIn.json()) as { token: string };
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 1000).toISOString();
    const response = await request.get(
      `${API_URL}/api/report/tolerance?from=${from}&to=${to}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.ok()).toBe(true);
    const { report } = (await response.json()) as {
      report: {
        failures: { componentId: string; zone: string; actualQuantity: string }[];
        overrideCount: number;
      };
    };
    const row = report.failures.find((entry) => entry.componentId === 'DYE-4471-B');
    expect(row?.zone).toBe('OVER');
    expect(row?.actualQuantity).toBe(poured);
    test.info().annotations.push({
      type: 'report.overrideCount',
      description: String(report.overrideCount),
    });
  });
});
