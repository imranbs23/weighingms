/**
 * The Step 28 capture — the prototype's three screens beside the app's.
 *
 * The e2e harness's own servers and database, with only the capture spec:
 *
 *   npm run evidence:step28
 *
 * The screenshots land in `evidence/STEP-28-ui-validation/`.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/step28-capture.spec.ts',
  reporter: [['list']],
});
