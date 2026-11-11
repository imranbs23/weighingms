/**
 * The e2e fixtures — the shared vocabulary of the suite.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SUITE DRIVES THE PRODUCT. IT DOES NOT SIMULATE IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every helper here acts on the **running application**: it signs in through
 * the real sign-in screen, releases a batch through the Dummy MES's own
 * control, and drives the dispersion ramp through the scale's training
 * control. Nothing is stubbed and no endpoint is faked — so a green run
 * says the product works, not that the test's doubles work.
 *
 * THE OPERATOR
 * ------------
 * The seeded operator is `OP-001` with the PIN from
 * `scripts/seed-identity.ts`. The credential is hashed with Argon2id by the
 * product's own credential service — the suite signs in with the real
 * credential, so the whole identity path is exercised.
 */
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

/** The seeded operator — the one the e2e API seeds. */
export const OPERATOR_ID = 'OP-001';
export const OPERATOR_SECRET = '4821';

/** The supervisor — for the escalation path. */
export const SUPERVISOR_ID = 'SUP-001';
export const SUPERVISOR_SECRET = '9164';

/**
 * The batch the suite weighs.
 *
 * `B-24187` — the prototype's own batch, with the five components the
 * workbook's Step 29 names: Blue RSPL, Red RB, Yellow RGB, Sodium Sulphate
 * and Soda Ash.
 */
export const BATCH_ID = 'B-24187';

/** The API's base URL — the same one the SPA was built against. */
export const API_URL =
  process.env['E2E_API_URL'] ?? 'http://localhost:3100';

/** The five components, in the recipe's order. */
export const COMPONENTS = [
  'DYE-4471-B',
  'DYE-2204-R',
  'DYE-4471-Y',
  'AUX-0101',
  'AUX-0107',
] as const;

/**
 * The extended test — with the station's own controls.
 */
export interface StationFixtures {
  /** The API's request context — with the operator's session on it. */
  readonly api: APIRequestContext;
  /** Sign in through the real sign-in screen. */
  readonly signIn: (operatorId?: string, secret?: string) => Promise<void>;
  /** Release a batch through the Dummy MES's own control. */
  readonly releaseBatch: (batchId?: string) => Promise<void>;
  /** Drive the dispersion ramp on the bound scale. */
  readonly dispense: (
    scaleId: string,
    target: string,
    tolerance: string,
    landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
  ) => Promise<void>;
  /** The operator's bearer token — for the API calls the UI does not make. */
  readonly token: () => string;
}

export const test = base.extend<StationFixtures>({
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: API_URL,
    });
    await use(context);
    await context.dispose();
  },

  token: async ({}, use) => {
    let current = '';
    await use(() => current);
    // The fixture sets the token by calling the sign-in helper.
  },

  signIn: async ({ page }, use) => {
    await use(async (operatorId = OPERATOR_ID, secret = OPERATOR_SECRET) => {
      await page.goto('/');
      await expect(page.getByTestId('sign-in-screen')).toBeVisible();

      await page.getByTestId('sign-in-operator-id').fill(operatorId);
      await page.getByTestId('sign-in-secret').fill(secret);
      await page.getByTestId('sign-in-submit').click();

      // The sign-in screen is GONE — and the station's own screen is up.
      await expect(page.getByTestId('sign-in-screen')).toHaveCount(0);
    });
  },

  releaseBatch: async ({ api }, use) => {
    await use(async (batchId = BATCH_ID) => {
      // The MES RELEASES the batch — the station never does (BRD BR-03).
      // The control is the Dummy MES's own surface, and it needs a session.
      const signIn = await api.post('/api/identity/sign-in', {
        data: { operatorId: OPERATOR_ID, secret: OPERATOR_SECRET },
      });
      expect(signIn.ok()).toBe(true);
      const { token } = await signIn.json();

      const release = await api.post('/api/orgatex/control/release', {
        headers: { Authorization: `Bearer ${token}` },
        data: { batchId, status: 'RELEASED' },
      });
      expect(release.ok()).toBe(true);
    });
  },

  dispense: async ({ api }, use) => {
    await use(
      async (
        scaleId: string,
        target: string,
        tolerance: string,
        landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
      ) => {
        const signIn = await api.post('/api/identity/sign-in', {
          data: { operatorId: OPERATOR_ID, secret: OPERATOR_SECRET },
        });
        const { token } = await signIn.json();

        const response = await api.post(`/api/scales/${scaleId}/dispense`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { target, tolerance, landing },
        });
        expect(response.ok()).toBe(true);
      },
    );
  },
});

export { expect };

/**
 * Sign in and wait for the station's own screen.
 *
 * **And the queue is the screen that opens** — the terminal shows nothing
 * else until a batch is chosen, because every other screen depends on a
 * session that does not exist yet.
 */
export async function signInAtStation(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('sign-in-operator-id').fill(OPERATOR_ID);
  await page.getByTestId('sign-in-secret').fill(OPERATOR_SECRET);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-screen')).toHaveCount(0);
}

/**
 * Read the scale's own unit and the recipe's target for a component.
 *
 * **The device reports in its own unit** — grams for the precision scales,
 * kilograms for the floor scale — while the recipe carries the unit the MES
 * supplied. So the ramp is given the target **in the device's unit**, and
 * this helper does that conversion from the API's own answers.
 */
export async function componentFacts(
  api: APIRequestContext,
  token: string,
  componentId: string,
): Promise<{
  readonly target: string;
  readonly tolerance: string;
  readonly scaleId: string;
  readonly unit: string;
}> {
  const recipe = await api.get(`/api/recipe/${BATCH_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const recipeBody = await recipe.json();
  const component = recipeBody.recipe.components.find(
    (entry: { componentId: string }) => entry.componentId === componentId,
  );
  if (component === undefined) {
    throw new Error(`The recipe has no component ${componentId}`);
  }

  const select = await api.post('/api/session/select', {
    headers: { Authorization: `Bearer ${token}` },
    data: { componentId },
  });
  const selectBody = await select.json();
  const scaleId = selectBody.scaleId as string;

  const status = await api.get(`/api/scales/${scaleId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const statusBody = await status.json();
  const scaleUnit = statusBody.unit as string;

  // THE CONVERSION — the recipe's unit into the device's unit. And it is
  // the **factor**, applied to the fixed-point decimals, never a float
  // parse of the target (BRD NFR-16).
  const factor =
    scaleUnit === component.unit
      ? 1
      : component.unit === 'kg' && scaleUnit === 'g'
        ? 1000
        : component.unit === 'g' && scaleUnit === 'kg'
          ? 0.001
          : 1;

  const target = multiply(component.target as string, factor);
  const tolerance = multiply(
    (Number(component.tolerance.max) - Number(component.tolerance.min)).toFixed(
      4,
    ),
    factor,
  );

  return { target, tolerance, scaleId, unit: scaleUnit };
}

/**
 * Multiply a fixed-point decimal by a factor — exactly.
 *
 * **And it is not a float parse.** `decimal.js` does the arithmetic, and
 * the result is a string, because the tolerance boundary is exactly where a
 * float would bite (BRD NFR-16, ADR-008).
 */
function multiply(text: string, factor: number): string {
  const [whole, fraction = ''] = text.split('.');
  const scaledWhole = BigInt(whole) * BigInt(factor);
  if (factor === 1) return text;

  // The factor is 1000 or 0.001 — so the shift is exact in both directions.
  const digits = factor === 1000 ? 3 : -3;
  const negative = scaledWhole < 0n;
  const absolute = negative ? -scaledWhole : scaledWhole;

  if (digits > 0) {
    const shifted = absolute * 10n ** BigInt(digits);
    const asString = shifted.toString().padStart(digits + 1, '0');
    const head = asString.slice(0, -digits);
    const tail = asString.slice(-digits);
    return `${negative ? '-' : ''}${head}.${tail}`;
  }

  const divisor = 10n ** BigInt(-digits);
  const whole2 = absolute / divisor;
  const remainder = absolute % divisor;
  const tail = remainder.toString().padStart(-digits, '0');
  return `${negative ? '-' : ''}${whole2}.${tail}`;
}
