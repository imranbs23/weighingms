/**
 * The Playwright configuration — the e2e harness.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE HARNESS RUNS THE REAL PRODUCT. TWO PROCESSES, AS IN PRODUCTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tech stack's service topology is two processes: the Express API on
 * :3000 and the Vite SPA on :5173. **The e2e suite runs both**, because an
 * e2e suite that stubs one of them is testing a fiction — and the whole
 * point of the workbook's Step 29 is *"Show Playwright result"* against the
 * working application.
 *
 * WHY A SEPARATE DATABASE
 * ------------------------
 * The API is started with its own database file and its own port, so the
 * suite never touches the development database. The file is **deleted**
 * before the run, so every run starts from the same world — and the
 * operator directory is seeded by the suite's own setup.
 *
 * WHY THE WEB SERVER IS THE REAL DEV SERVER
 * ------------------------------------------
 * `npm run dev:ui` is the Vite dev server with the project's own config —
 * the same one a developer runs. A production build served by `vite preview`
 * would test a different bundle, and the point of the suite is that the
 * **working application** works.
 */
import { defineConfig, devices } from '@playwright/test';

const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3100);
const UI_PORT = Number(process.env['E2E_UI_PORT'] ?? 5174);

/** The API's base URL — and the SPA's `VITE_API_BASE_URL` points at it. */
export const E2E_API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './playwright',
  // The Step 28 capture is evidence tooling with its own config
  // (`playwright.capture.config.ts`): it needs a fresh world, and B-24187
  // leaves the released queue once the suite has weighed it.
  // ... and the Step 30 failure scenarios have theirs too
  // (`playwright.failures.config.ts`): a fresh world and a short sync backoff.
  // ... and so does the Step 24 overshoot rule (`playwright.step24.config.ts`):
  // it completes B-24187 through a supervisor override.
  // ... and the backfilled evidence captures (`playwright.evidence.config.ts`).
  testIgnore: ['**/step28-capture.spec.ts', '**/failures/**', '**/step24/**', '**/evidence/**'],
  // The specs share ONE running product and ONE database — so they run in
  // order, one at a time. A parallel suite would have two batches fighting
  // over one MES world.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'evidence/STEP-29-playwright-report', open: 'never' }],
    ['json', { outputFile: 'evidence/STEP-29-playwright-report/results.json' }],
  ],
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // THE API — the real Express application, on its own port and its own
      // database. The database file is removed first, so the world is the
      // same at the start of every run.
      command: `node scripts/e2e-api.mjs ${API_PORT}`,
      url: `${E2E_API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(API_PORT),
        WEIGHINGMS_DB_PATH: './data/e2e-weighingms.sqlite',
        WEIGHINGMS_SESSION_LIFETIME_MS: '3600000',
        // THE SPA's ORIGIN — and it is this harness's own port, not the
        // development one. The API's allow-list is configuration, so the
        // harness states its own origin rather than relying on the default.
        WEIGHINGMS_CORS_ORIGINS: `http://localhost:${UI_PORT}`,
      },
    },
    {
      // THE SPA — the real Vite dev server, pointed at the API above.
      command: `npx vite --config vite.config.ts --port ${UI_PORT} --strictPort`,
      url: `http://localhost:${UI_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_API_BASE_URL: E2E_API_URL,
      },
    },
  ],
});
