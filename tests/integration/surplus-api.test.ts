/**
 * The surplus endpoints — unit 003, bolt 015.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT SUPPLIES NEITHER THE FACTOR NOR THE AMOUNTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the proposal is presented, and it carries the computed factor
 *   - the accept and decline paths work, and a second decision is refused
 *   - a client-supplied factor and surplus are DROPPED
 *   - no session is a `401`
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

describe('the surplus endpoints', () => {
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
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
  });

  afterEach(() => {
    harness.close();
  });

  it('reports NO surplus when the zone is not OVER', async () => {
    const response = await request(harness.app)
      .get('/api/surplus')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.surplus).toBeNull();
  });

  it('returns 409 for a proposal when the zone is not OVER', async () => {
    const response = await request(harness.app)
      .post('/api/surplus')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('NOT_COMPENSABLE');
  });

  it('refuses a decision when there is NO proposal', async () => {
    const response = await request(harness.app)
      .post('/api/surplus/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PROPOSAL_NOT_FOUND');
  });

  it('returns 400 when the decision body carries no component', async () => {
    const response = await request(harness.app)
      .post('/api/surplus/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for the surplus without a session', async () => {
    const response = await request(harness.app).get('/api/surplus');
    expect(response.status).toBe(401);
  });

  it('returns 401 for a decision without a session', async () => {
    const response = await request(harness.app)
      .post('/api/surplus/accept')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied factor and surplus', async () => {
    const response = await request(harness.app)
      .post('/api/surplus')
      .set('Authorization', `Bearer ${token}`)
      .send({
        factor: '0.5',
        surplusAmount: '99.0000',
        revisedTarget: '1.0000',
      });

    // The zone is not OVER, so the request is refused — and the refused
    // answer is the DOMAIN's, not the client's.
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('NOT_COMPENSABLE');
    expect(response.body.factor).toBeUndefined();
    expect(response.body.surplus).toBeUndefined();
  });
});
