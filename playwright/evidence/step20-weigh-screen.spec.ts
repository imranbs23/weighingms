/**
 * Step 20 — Implement the Weighing Screen (backfilled evidence).
 *
 * The weigh view mid-pour, in tolerance, with each element the workbook
 * lists checked on the live page — present or MISSING, never assumed.
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

test('Step 20 — the weigh view shows the workbook’s elements, from the API', async ({
  page,
  releaseBatch,
}) => {
  await releaseBatch();
  await signInAtStation(page);
  await toTheQueue(page);
  await page.getByTestId(`queue-row-${BATCH_ID}`).click();
  await expect(page.getByTestId('weigh-screen')).toBeVisible();

  // THE LOT AND THE CONTAINER (bolt 031). Remazol Blue's lot is the MES's,
  // retrieved as the component is prepared; the container is scanned —
  // a barcode wedge ends with Enter — and takes its master tare.
  await expect(page.getByTestId('weigh-meta')).toContainText('Lot 2026-0341');
  await page.getByTestId('prepare-container-input').fill('C-09');
  await page.getByTestId('prepare-container-input').press('Enter');
  await expect(page.getByTestId('weigh-meta')).toContainText('Container C-09');
  await expect(page.getByTestId('weigh-meta')).toContainText('Tare 214');
  await expect(page.getByTestId('prepare-panel')).toHaveCount(0);

  // A pour that lands in tolerance — so the readout, the band, the status
  // and an ENABLED confirm are all on screen. Nothing is confirmed.
  await page.getByTestId('training-dispense').click();
  await expect(page.getByTestId('status-line')).toHaveAttribute('data-zone', 'OK', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('confirm-action')).toBeEnabled();
  await page.screenshot({ path: 'evidence/STEP-20-weigh-screen.png', fullPage: true });

  // THE WORKBOOK'S LIST, checked on the live page.
  const meta = (await page.getByTestId('weigh-meta').textContent()) ?? '';
  const text = async (id: string) => (await page.getByTestId(id).innerText()).replace(/\s+/g, ' ').trim();
  const checks = [
    { element: 'Component', present: (await text('weigh-name')).length > 0, shows: await text('weigh-name') },
    { element: 'Code', present: /DYE-|AUX-/.test(meta), shows: meta },
    { element: 'Lot', present: /Lot \S+/.test(meta), shows: /Lot \S+/.exec(meta)?.[0] ?? 'not shown' },
    { element: 'Container', present: /Container \S+/.test(meta), shows: /Container \S+/.exec(meta)?.[0] ?? 'not shown' },
    { element: 'Tare', present: /Tare [\d.]+ \S+/.test(meta), shows: /Tare [\d.]+ \S+/.exec(meta)?.[0] ?? 'not shown' },
    { element: 'Scale Selected', present: await page.getByTestId('weigh-scale').isVisible(), shows: await text('weigh-scale') },
    { element: 'Weighed Now', present: await page.getByTestId('live-weight-value').isVisible(), shows: await text('live-weight-value') },
    { element: 'Still To Weigh', present: await page.getByTestId('live-still-to-weigh').isVisible(), shows: await text('live-still-to-weigh') },
    { element: 'Target', present: await page.getByTestId('live-target').isVisible(), shows: await text('live-target') },
    { element: 'Progress', present: await page.getByTestId('tolerance-band-bar').isVisible(), shows: 'the fill bar, 0 → scale capacity' },
    { element: 'Tolerance', present: await page.getByTestId('tolerance-band-caption').isVisible(), shows: await text('tolerance-band-caption') },
    { element: 'Status', present: await page.getByTestId('status-line').isVisible(), shows: await text('status-line') },
    { element: 'OK', present: await page.getByTestId('confirm-action').isEnabled(), shows: 'OK · Confirm (F1), enabled in tolerance' },
    { element: 'Re-tare', present: await page.getByTestId('retare-action').isVisible(), shows: 'Re-tare (F2)' },
    { element: 'Quit', present: await page.getByTestId('abandon-action').isVisible(), shows: 'Quit (F4)' },
    { element: 'Supervisor Override', present: await page.getByTestId('override-action').isVisible(), shows: 'shown; enabled only while OVER (ADR-047)' },
  ];

  const missing = checks.filter((check) => !check.present).map((check) => check.element);
  writeFileSync(
    'evidence/STEP-20-weigh-screen.md',
    [
      '---',
      'step: 20',
      `captured: ${new Date().toISOString().slice(0, 10)}`,
      'backfill: true',
      'source: playwright/evidence/step20-weigh-screen.spec.ts (fresh product)',
      '---',
      '',
      '# Step 20 — Implement the Weighing Screen',
      '',
      '> **Backfilled evidence.** The weigh view was built by bolts 025–029;',
      '> this capture is from a fresh product. Each element the workbook lists',
      '> was checked on the live page.',
      '',
      '| Workbook element | On the weigh view | Shows |',
      '|---|---|---|',
      ...checks.map((check) => `| ${check.element} | ${check.present ? 'yes' : '**MISSING**'} | ${check.shows.replace(/\s+/g, ' ').replace(/\|/g, '\\|')} |`),
      '',
      missing.length === 0
        ? 'Every listed element is present.'
        : `**Missing: ${missing.join(', ')}.**`,
      '',
      'The first capture of this step (before bolt 031) found Lot, Container and',
      'Tare missing; bolt 031 added the Prepare panel, the MES lot retrieval and',
      'the header line, and this capture was re-taken after it.',
      '',
    ].join('\n'),
  );
  test.info().annotations.push({ type: 'missing', description: missing.join(', ') || 'none' });
});
