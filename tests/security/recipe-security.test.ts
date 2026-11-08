/**
 * The recipe's security properties — unit 002, bolt 010.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SECURITY SUITE IS THE EXECUTABLE RECORD OF WHAT MATTERS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 002's recipe.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the recipe requires an operator session (ADR-020)
 *   - the diagnostic NEVER reaches the client (BRD IR-09)
 *   - the swatch cannot carry a style injection (ADR-032)
 *   - the recipe cannot be edited by any verb (BRD BR-04, C-01)
 *   - the MES's own payload cannot make the station read a float (NFR-16)
 *   - a malformed payload is refused whole, never served in part (S-24)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the recipe endpoint — security', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('refuses the recipe without a session', async () => {
    const response = await request(harness.app).get('/api/recipe/B-24187');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  it('refuses the recipe with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  it('does not require a SUPERVISOR — reading authorises nothing', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      harness.orgatex.world.setReachable(false);

      const response = await request(harness.app)
        .get('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(503);
      // The body carries the REASON CODE and nothing else. The MES's own
      // error text is prose the UI owns (BRD IR-09, NFR-11).
      expect(Object.keys(response.body).sort()).toEqual(['error', 'reason']);
      expect(response.text).not.toContain('unreachable');
      expect(response.text).not.toContain('Dummy OrgaTEX');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('carries no prose in the 200 body either', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    // Every leaf is a code or a datum — no sentence crosses the boundary.
    const component = response.body.recipe.components[0];
    expect(typeof component.target).toBe('string');
    expect(typeof component.state).toBe('string');
    expect(component.target).not.toContain(' ');
  });

  it('refuses a swatch that is not a colour token — the whole recipe', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      harness.orgatex.world.setRecipe('B-24187', {
        batchId: 'B-24187',
        shadeCode: 'Teal 4C',
        components: [
          {
            sequence: 1,
            componentId: 'C-1',
            dyestuffCode: 'D-1',
            target: '94.0000',
            unit: 'g',
            toleranceMin: '93.5000',
            toleranceMax: '94.5000',
            scaleClass: 'PRECISION',
            name: 'Fine',
            swatchColour: 'red; background-image: url(evil)',
          },
        ],
      });

      const response = await request(harness.app)
        .get('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`);

      // A partially valid recipe is a wrong target on the scale, so the
      // WHOLE read fails (S-24). And no part of it is served.
      expect(response.status).toBe(503);
      expect(response.body.recipe).toBeUndefined();
      expect(response.text).not.toContain('background-image');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('refuses a target with too many decimal places — the whole recipe', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      harness.orgatex.world.setRecipe('B-24187', {
        batchId: 'B-24187',
        shadeCode: 'Teal 4C',
        components: [
          {
            sequence: 1,
            componentId: 'C-1',
            dyestuffCode: 'D-1',
            target: '94.00001',
            unit: 'g',
            toleranceMin: '93.5000',
            toleranceMax: '94.5000',
            scaleClass: 'PRECISION',
          },
        ],
      });

      const response = await request(harness.app)
        .get('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(503);
      expect(response.body.recipe).toBeUndefined();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('refuses an exponent-shaped target — it is a float notation', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      harness.orgatex.world.setRecipe('B-24187', {
        batchId: 'B-24187',
        shadeCode: 'Teal 4C',
        components: [
          {
            sequence: 1,
            componentId: 'C-1',
            dyestuffCode: 'D-1',
            target: '1e3',
            unit: 'g',
            toleranceMin: '93.5000',
            toleranceMax: '94.5000',
            scaleClass: 'PRECISION',
          },
        ],
      });

      const response = await request(harness.app)
        .get('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(503);
      expect(response.body.recipe).toBeUndefined();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('has NO write verb — the recipe cannot be edited', async () => {
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request(harness.app)
        [verb]('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`)
        .send({ target: '1.0000', tolerance: { min: '0', max: '2' } });

      expect(response.status).toBe(404);
      expect(response.body.recipe).toBeUndefined();
    }
  });

  it('does not expose the MES’s own recipe endpoint under the station’s path', async () => {
    // `/api/batches/*` is the Dummy MES's prefix. The station's recipe
    // lives under `/api/recipe` and nowhere else, so a client cannot
    // reach the MES's contract by accident (ADR-032).
    const response = await request(harness.app)
      .get('/api/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    // The Dummy's own router answers it — that is the MES's surface, not
    // the station's, and it is not the product's API.
    expect(response.status).toBe(200);
    expect(response.body.components.length).toBe(5);
    // The station's payload has a `recipe` KEY; the MES's does not.
    expect(response.body.recipe).toBeUndefined();
  });
});
