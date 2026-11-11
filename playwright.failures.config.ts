/**
 * Step 30 — the failure scenarios, in their own world.
 *
 *   npm run test:e2e:failures
 *
 * The same two-process harness as `playwright.config.ts`, with a fresh
 * database, the failure spec only, and the OrgaTEX sync on a short backoff
 * so the write-back's recovery is seen within the run rather than after
 * the production five-minute ceiling.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testDir: './playwright/failures',
  testIgnore: [],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'evidence/STEP-30-playwright-report', open: 'never' }],
    ['json', { outputFile: 'evidence/STEP-30-playwright-report/results.json' }],
  ],
  webServer: servers.map((server, index) =>
    index === 0
      ? {
          ...server,
          env: {
            ...server.env,
            WEIGHINGMS_ORGATEX_SYNC_BACKOFF_BASE_MS: '500',
            WEIGHINGMS_ORGATEX_SYNC_BACKOFF_MAX_MS: '2000',
            WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS: '1000',
          },
        }
      : server,
  ),
});
