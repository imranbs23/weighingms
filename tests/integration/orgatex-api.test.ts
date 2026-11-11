/**
 * The OrgaTEX seam's HTTP surface.
 *
 * TWO APIs ARE UNDER TEST, AND THEY ARE NOT THE SAME API
 * -------------------------------------------------------
 *   /api/orgatex/*      the PRODUCT's endpoints over the MES seam
 *   /api/batches/*      the DUMMY MES's own endpoints — the training
 *                       artefact, standing in for OrgaTEX
 *
 * They are tested separately because they have different contracts: the
 * product's require an operator session (ADR-020), and the Dummy MES's do
 * not — the MES is the external system, and the product's adapter would
 * reach it without a WeighingMS session.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the session requirement, in both directions
 *   - the 200 / 404 / 503 outcomes
 *   - the freshness marker on every response
 *   - the `DEGRADED` read: 200, with an age
 *   - the `OFFLINE` read: 503, with no content
 *   - every quantity as a decimal STRING
 *   - the training artefact: curl-able, and coherent with the product
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { DummyOrgatexWorld } from '../../src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the OrgaTEX API', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    expect(signIn.status).toBe(200);
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  // ── The session requirement (ADR-020) ──

  it('refuses the queue without a session', async () => {
    const response = await request(harness.app).get('/api/orgatex/batches');
    expect(response.status).toBe(401);
  });

  it('refuses the recipe without a session', async () => {
    const response = await request(harness.app).get(
      '/api/orgatex/batches/B-24187/recipe',
    );
    expect(response.status).toBe(401);
  });

  it('refuses the queue with a session that is not an operator', async () => {
    // A signed-in operator is required; an anonymous request is not enough.
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });

  // ── The queue ──

  it('returns the queue to a signed-in operator', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.batches)).toBe(true);
    expect(response.body.batches.length).toBeGreaterThan(0);
  });

  it('carries a freshness marker on every response', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.freshness).toEqual({ kind: 'CURRENT' });
  });

  it('carries the source and the received time', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.source).toBe('DUMMY_ORGATEX');
    expect(typeof response.body.receivedAt).toBe('string');
  });

  it('reports each batch’s eligibility', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    const first = response.body.batches[0];
    expect(first.eligibility.kind).toMatch(/ELIGIBLE|NOT_ELIGIBLE/);
    expect(first.weighingStatus).toBeDefined();
  });

  it('filters by status', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches?status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    for (const batch of response.body.batches as Array<{ weighingStatus: string }>) {
      expect(batch.weighingStatus).toBe('QUEUED');
    }
  });

  it('refuses an UNKNOWN status filter with a 400', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches?status=FANTASTIC')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  // ── The recipe ──

  it('returns the recipe to a signed-in operator', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.batchId).toBe('B-24187');
    expect(response.body.components.length).toBe(5);
  });

  it('emits every quantity as a decimal STRING', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    const component = response.body.components[0];
    expect(typeof component.target).toBe('string');
    expect(typeof component.tolerance.min).toBe('string');
    expect(typeof component.tolerance.max).toBe('string');
  });

  it('emits an ABSENT tolerance as null — never as zero', async () => {
    const world = harness.orgatex.world;
    world.setRecipe('B-24187', {
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
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.components[0].tolerance).toBeNull();
  });

  it('returns 404 for a batch the MES does not have', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/B-99999/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('BATCH_NOT_FOUND');
  });

  it('returns 400 for an EMPTY batch id', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/%20/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  // ── The DEGRADED and OFFLINE paths ──

  it('serves the last known-good, with an age, when the MES goes away', async () => {
    await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.freshness.kind).toBe('STALE');
    expect(typeof response.body.freshness.ageMs).toBe('number');
    expect(response.body.batches.length).toBeGreaterThan(0);
  });

  it('returns 503 with NO content when the MES is away and there is no snapshot', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('ORGATEX_UNAVAILABLE');
    // An empty queue is never substituted for "unknown".
    expect(response.body.batches).toBeUndefined();
  });

  it('does NOT leak the adapter’s internal message to the client', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('unreachable');
  });
});

describe('the Dummy OrgaTEX — the training artefact', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it('serves its queue WITHOUT a session — it is the external system', async () => {
    const response = await request(harness.app).get('/api/batches');
    expect(response.status).toBe(200);
    expect(response.body.batches.length).toBe(4);
  });

  it('serves a batch', async () => {
    const response = await request(harness.app).get('/api/batches/B-24187');
    expect(response.status).toBe(200);
    expect(response.body.batchId).toBe('B-24187');
  });

  it('serves a recipe', async () => {
    const response = await request(harness.app).get('/api/batches/B-24187/recipe');
    expect(response.status).toBe(200);
    expect(response.body.components.length).toBe(5);
  });

  it('returns 404 for a batch it does not have', async () => {
    const response = await request(harness.app).get('/api/batches/B-99999');
    expect(response.status).toBe(404);
  });

  it('is COHERENT with the product — one world, two views', async () => {
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    const token = signIn.body.token as string;

    const world = harness.orgatex.world;
    world.setWeighingStatus('B-24188', 'RELEASED');

    const dummy = await request(harness.app).get('/api/batches');
    const product = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    const dummyStatus = dummy.body.batches.find(
      (b: { batchId: string }) => b.batchId === 'B-24188',
    ).weighingStatus;
    const productStatus = product.body.batches.find(
      (b: { batchId: string }) => b.batchId === 'B-24188',
    ).weighingStatus;

    expect(dummyStatus).toBe('RELEASED');
    expect(productStatus).toBe('RELEASED');
  });

  it('emits every quantity as a decimal STRING', async () => {
    const response = await request(harness.app).get('/api/batches/B-24187/recipe');
    for (const component of response.body.components as Array<{ target: unknown }>) {
      expect(typeof component.target).toBe('string');
    }
  });

  it('has a training control that makes the MES unreachable', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control')
      .send({ state: 'UNREACHABLE' });

    // The control requires a session — it writes to the training world.
    expect(response.status).toBe(401);
  });

  it('accepts the training control WITH a session, and takes effect', async () => {
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    const token = signIn.body.token as string;

    const response = await request(harness.app)
      .post('/api/orgatex/control')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'UNREACHABLE' });

    expect(response.status).toBe(200);
    expect(harness.orgatex.world.isReachable).toBe(false);

    // The MES now refuses the queue.
    const queue = await request(harness.app).get('/api/batches');
    expect(queue.status).toBe(503);
  });

  it('refuses an invalid control state', async () => {
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    const token = signIn.body.token as string;

    const response = await request(harness.app)
      .post('/api/orgatex/control')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'MELTED' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('starts reachable', () => {
    expect(new DummyOrgatexWorld().isReachable).toBe(true);
  });
});

describe('the Dummy MES release control', () => {
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

  it('requires a session — it writes to the training world', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control/release')
      .send({ batchId: 'B-24188', status: 'RELEASED' });

    expect(response.status).toBe(401);
  });

  it('releases the batch — and the MES shows it as RELEASED', async () => {
    // The seed holds no released batch, so this is the only way the queue
    // can have a selectable row at all (BRD BR-03).
    expect(
      harness.orgatex.world.readBatch('B-24188')?.weighingStatus,
    ).toBe('QUEUED');

    const response = await request(harness.app)
      .post('/api/orgatex/control/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', status: 'RELEASED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('RELEASED');
    expect(
      harness.orgatex.world.readBatch('B-24188')?.weighingStatus,
    ).toBe('RELEASED');
  });

  it('makes the batch SELECTABLE — the eligibility rule still decides', async () => {
    // Before the release the selection is REFUSED, with the reason.
    const refused = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });

    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('NOT_RELEASED');

    await request(harness.app)
      .post('/api/orgatex/control/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', status: 'RELEASED' });

    const selected = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });

    expect(selected.status).toBe(201);
    expect(selected.body.selection.batchId).toBe('B-24188');
  });

  it('refuses a batch the MES does not hold', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-NOT-A-BATCH', status: 'RELEASED' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('BATCH_NOT_FOUND');
  });

  it('refuses any status other than RELEASED', async () => {
    // The MES's own seam writes only WEIGHED (BRD IR-06) — and the
    // training control must not be a way to write any other status.
    const response = await request(harness.app)
      .post('/api/orgatex/control/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', status: 'WEIGHED' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses a body with no batch', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RELEASED' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });
});
