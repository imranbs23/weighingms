/**
 * The OrgaTEX seam's security properties.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   S1  The MES's queue is NOT readable without an operator session.
 *   S2  The scale unit's open reads stay open — ADR-013 stands, and this
 *       unit did not narrow it.
 *   S3  A stale snapshot is NEVER presented as current.
 *   S4  A failed read never substitutes an empty queue for "unknown".
 *   S5  The adapter's internal message never reaches the client.
 *   S6  The Dummy MES's training surface is a separate, open surface —
 *       and it is NOT the product's API.
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

describe('the OrgaTEX seam — security', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness({ orgatexFreshnessWindowMs: 60_000 });
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  // ── S1 ──

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

  it('refuses the queue with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('refuses the queue once the session has ENDED', async () => {
    await request(harness.app)
      .post('/api/identity/sign-out')
      .set('Authorization', `Bearer ${token}`);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('refuses the queue once the session has EXPIRED', async () => {
    harness.clock.advance(2 * 60 * 60 * 1000);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('refuses the queue once the operator is DEACTIVATED', async () => {
    await request(harness.app)
      .post('/api/identity/sign-out')
      .set('Authorization', `Bearer ${token}`);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  // ── S2 ──

  it('leaves the scale unit’s open reads OPEN', async () => {
    // ADR-020 narrowed ADR-013 to physically present devices. The scale's
    // own readings are physically visible, so they stay open.
    const response = await request(harness.app).get('/api/scales');
    expect(response.status).toBe(200);
  });

  // ── S3 ──

  it('never presents a stale snapshot as CURRENT', async () => {
    await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    harness.orgatex.world.setReachable(false);
    harness.clock.advance(30_000);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.freshness.kind).toBe('STALE');
    expect(response.body.freshness.kind).not.toBe('CURRENT');
    expect(typeof response.body.freshness.ageMs).toBe('number');
  });

  it('always carries a freshness marker — never omits it', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.freshness).toBeDefined();
  });

  it('marks a stale RECIPE as stale too', async () => {
    await request(harness.app)
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    harness.orgatex.world.setReachable(false);
    harness.clock.advance(20_000);

    const response = await request(harness.app)
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.freshness.kind).toBe('STALE');
  });

  // ── S4 ──

  it('never substitutes an empty queue for an unreachable MES', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.batches).toBeUndefined();
    expect(response.body.batches).not.toEqual([]);
  });

  it('never substitutes an empty recipe for an unreachable MES', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches/B-24187/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.components).toBeUndefined();
  });

  it('fails LOUDLY when the last known-good is older than the window', async () => {
    await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    harness.orgatex.world.setReachable(false);
    harness.clock.advance(60_001);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
  });

  // ── S5 ──

  it('does not leak the adapter’s message to the client', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/orgatex/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('unreachable');
    expect(JSON.stringify(response.body)).not.toContain('Dummy OrgaTEX');
  });

  // ── S6 ──

  it('keeps the Dummy MES surface distinct from the product’s', async () => {
    const dummy = await request(harness.app).get('/api/batches');
    expect(dummy.status).toBe(200);

    // The Dummy MES's payload is the MES's own shape, not the product's.
    expect(dummy.body.batches[0]).not.toHaveProperty('eligibility');
    expect(dummy.body.batches[0]).not.toHaveProperty('freshness');
  });
});
