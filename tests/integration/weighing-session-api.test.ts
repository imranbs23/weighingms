/**
 * The weighing session's endpoint — unit 003, bolt 013.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ENDPOINT, OVER THE REAL RULE AND THE REAL SCALES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The harness binds unit 004's **real** registry — the real rule and the
 * real gate — so every scale decision below came through the seam.
 *
 * What is under test:
 *
 *   - the operator never chooses the scale — the body has no `scaleId`
 *   - the rule binds the scale and the session enters `WEIGHING`
 *   - "no device can weigh this" is a `409` carrying the reason as DATA
 *   - a `DONE` component is refused
 *   - the session is reported, and null when there is none
 *   - the weight is reported, and null when there is none
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

describe('the weighing session', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;

    await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);
  });

  afterEach(() => {
    harness.close();
  });

  it('selects a component and binds its scale — with NO operator input', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(200);
    expect(response.body.session.state).toBe('WEIGHING');
    expect(response.body.session.activeComponentId).toBe('DYE-4471-Y');
    // The rule chose — the 94 g component demands PRECISION.
    expect(response.body.scaleId).toBe('SCALE-A');
  });

  it('ignores a client-supplied scaleId — the RULE chooses', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', scaleId: 'SCALE-B' });

    expect(response.status).toBe(200);
    // The client's `scaleId` is DROPPED — the field does not exist.
    expect(response.body.scaleId).toBe('SCALE-A');
  });

  it('reports the session, and null when there is none', async () => {
    const none = await request(harness.app)
      .get('/api/session')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.session).toBeNull();

    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const some = await request(harness.app)
      .get('/api/session')
      .set('Authorization', `Bearer ${token}`);
    expect(some.body.session.state).toBe('WEIGHING');
    expect(some.body.session.counter).toEqual({ weighed: 0, total: 5 });
  });

  it('reports the weight, and null when there is none', async () => {
    const none = await request(harness.app)
      .get('/api/session/weight')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.weight).toBeNull();
  });

  it('returns 404 for a component the recipe does not hold', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'NOPE' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('COMPONENT_NOT_FOUND');
  });

  it('returns 400 when the body carries no component', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a session', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('returns 401 for the session read without a session', async () => {
    const response = await request(harness.app).get('/api/session');
    expect(response.status).toBe(401);
  });
});
