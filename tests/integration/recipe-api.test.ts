/**
 * The station's recipe — unit 002, bolt 010.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DATA REALLY COMES FROM THE MES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The harness binds the real `RecipeReader` over the real Dummy OrgaTEX, so
 * every component below arrived through the seam. There is no fixture and
 * no double.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the components arrive in RECIPE SEQUENCE
 *   - every quantity is a **string** — never a JSON number
 *   - an ABSENT tolerance is `null` — never a band of zero
 *   - an absent name or swatch is `null` — never a fabricated one
 *   - the counter is DERIVED from the states, and is `0 of N` at load
 *   - every component starts `PENDING`
 *   - the freshness is passed through from unit 005, unchanged
 *   - a batch the MES does not know is a 404 — never a 503
 *   - an unreachable MES is a 503 with **no `recipe` key at all**
 *   - a malformed batch id is a 400
 *   - no session is a 401
 *   - the recipe is READ-ONLY — there is no write verb
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the station recipe', () => {
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

  // ── The happy path ──

  it('returns the recipe to a signed-in operator', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.recipe.batchId).toBe('B-24187');
    expect(response.body.recipe.shadeCode).toBe('Teal 4C');
    expect(response.body.recipe.components.length).toBe(5);
  });

  it('presents the components in RECIPE SEQUENCE', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const sequences = response.body.recipe.components.map(
      (component: { sequence: number }) => component.sequence,
    );
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it('emits every quantity as a decimal STRING', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const component = response.body.recipe.components[0];
    expect(typeof component.target).toBe('string');
    expect(typeof component.tolerance.min).toBe('string');
    expect(typeof component.tolerance.max).toBe('string');
  });

  it('carries the unit alongside the target', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const components = response.body.recipe.components as Array<{
      unit: string;
      target: string;
    }>;
    expect(components[0]?.unit).toBe('g');
    expect(components[3]?.unit).toBe('kg');
  });

  it('carries the display facts the MES supplied', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const component = response.body.recipe.components[2];
    expect(component.dyestuffCode).toBe('DYE-4471');
    expect(component.name).toBe('Remazol Yellow RGB');
    expect(component.swatchColour).toBe('#d9a520');
  });

  it('starts every component PENDING', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const states = response.body.recipe.components.map(
      (component: { state: string }) => component.state,
    );
    expect(states).toEqual(['PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
  });

  it('derives the counter from the states — 0 of 5 at load', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.recipe.counter).toEqual({ weighed: 0, total: 5 });
  });

  it('carries the receipt time, the source and the freshness', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(typeof response.body.recipe.receivedAt).toBe('string');
    expect(response.body.recipe.source).toBe('DUMMY_ORGATEX');
    expect(response.body.recipe.freshness.kind).toBe('CURRENT');
  });

  // ── The absent facts ──

  it('emits an ABSENT tolerance as null — never as zero', async () => {
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
          toleranceMin: null,
          toleranceMax: null,
          scaleClass: 'PRECISION',
        },
      ],
    });

    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.recipe.components[0].tolerance).toBeNull();
  });

  it('emits an ABSENT name and swatch as null — never a fabricated one', async () => {
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
        },
      ],
    });

    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const component = response.body.recipe.components[0];
    expect(component.name).toBeNull();
    expect(component.swatchColour).toBeNull();
  });

  // ── The edge cases ──

  it('serves a recipe with ZERO components — and it is NOT an error', async () => {
    harness.orgatex.world.setRecipe('B-24188', {
      batchId: 'B-24188',
      shadeCode: 'Teal 4C',
      components: [],
    });

    const response = await request(harness.app)
      .get('/api/recipe/B-24188')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.recipe.components).toEqual([]);
    expect(response.body.recipe.counter).toEqual({ weighed: 0, total: 0 });
  });

  it('does NOT de-duplicate two components with the same dyestuff code', async () => {
    harness.orgatex.world.setRecipe('B-24187', {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        {
          sequence: 1,
          componentId: 'C-1',
          dyestuffCode: 'D-SAME',
          target: '10.0000',
          unit: 'g',
          toleranceMin: '9.0000',
          toleranceMax: '11.0000',
          scaleClass: 'PRECISION',
        },
        {
          sequence: 2,
          componentId: 'C-2',
          dyestuffCode: 'D-SAME',
          target: '20.0000',
          unit: 'g',
          toleranceMin: '19.0000',
          toleranceMax: '21.0000',
          scaleClass: 'PRECISION',
        },
      ],
    });

    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.recipe.components.length).toBe(2);
    expect(response.body.recipe.components[0].target).toBe('10.0000');
    expect(response.body.recipe.components[1].target).toBe('20.0000');
  });

  it('orders the components by their sequence even if the MES sent them shuffled', async () => {
    harness.orgatex.world.setRecipe('B-24187', {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        {
          sequence: 3,
          componentId: 'C-3',
          dyestuffCode: 'D-3',
          target: '30.0000',
          unit: 'g',
          toleranceMin: '29.0000',
          toleranceMax: '31.0000',
          scaleClass: 'PRECISION',
        },
        {
          sequence: 1,
          componentId: 'C-1',
          dyestuffCode: 'D-1',
          target: '10.0000',
          unit: 'g',
          toleranceMin: '9.0000',
          toleranceMax: '11.0000',
          scaleClass: 'PRECISION',
        },
        {
          sequence: 2,
          componentId: 'C-2',
          dyestuffCode: 'D-2',
          target: '20.0000',
          unit: 'g',
          toleranceMin: '19.0000',
          toleranceMax: '21.0000',
          scaleClass: 'PRECISION',
        },
      ],
    });

    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    const ids = response.body.recipe.components.map(
      (component: { componentId: string }) => component.componentId,
    );
    expect(ids).toEqual(['C-1', 'C-2', 'C-3']);
  });

  // ── The failures ──

  it('returns 404 for a batch the MES does not have', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/B-99999')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('BATCH_NOT_FOUND');
  });

  it('returns 503 with NO recipe key when the MES is unreachable', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('RECIPE_UNAVAILABLE');
    expect(response.body.reason).toBe('UNREACHABLE');
    // The KEY POINT: an unreachable MES can never be mistaken for an empty
    // recipe, because there is no `recipe` key at all.
    expect(response.body.recipe).toBeUndefined();
  });

  it('returns 400 for an EMPTY batch id', async () => {
    const response = await request(harness.app)
      .get('/api/recipe/%20')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a session', async () => {
    const response = await request(harness.app).get('/api/recipe/B-24187');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  // ── The read-only rule ──

  it('has NO write verb — the recipe cannot be edited', async () => {
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request(harness.app)
        [verb]('/api/recipe/B-24187')
        .set('Authorization', `Bearer ${token}`)
        .send({ target: '1.0000' });

      expect(response.status).toBe(404);
    }
  });
});
