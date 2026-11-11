/**
 * Backfilled workbook evidence that needs the running product.
 *
 *   EVIDENCE_STEP=19 npx playwright test -c playwright.evidence.config.ts step19
 *
 * The same two-process harness as `playwright.config.ts`, with a fresh
 * database. Each step's report goes to `evidence/STEP-NN-playwright-report`.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const step = process.env['EVIDENCE_STEP'] ?? 'XX';

export default defineConfig({
  ...base,
  testDir: './playwright/evidence',
  testIgnore: [],
  reporter: [
    ['list'],
    ['html', { outputFolder: `evidence/STEP-${step}-playwright-report`, open: 'never' }],
  ],
});
