/**
 * Step 24 — the overshoot rule, in its own world.
 *
 *   npm run test:e2e:step24
 *
 * The same two-process harness as `playwright.config.ts`, with a fresh
 * database and the Step 24 spec only: it completes B-24187 through a
 * supervisor override, so it cannot share a run with the specs that weigh
 * the same batch.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testDir: './playwright/step24',
  testIgnore: [],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'evidence/STEP-24-playwright-report', open: 'never' }],
    ['json', { outputFile: 'evidence/STEP-24-playwright-report/results.json' }],
  ],
});
