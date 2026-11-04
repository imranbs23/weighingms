/**
 * The station's batch queue endpoint.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DATA REALLY COMES FROM THE MES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The harness binds the real `BatchQueueReader` over the real Dummy
 * OrgaTEX, so every row in every response below arrived through the seam.
 * There is no fixture and no double — which is the point of FR-1: *"the
 * queue is never embedded in the client"*, and a test that injected the
 * rows would not have proved it.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the session requirement (ADR-020)
 *   - the seven FR-1 columns, on every row
 *   - the receipt time and the source
 *   - the freshness marker, on every response
 *   - an EMPTY queue is a 200 with zero rows — not an error
 *   - an UNREACHABLE MES is a 503 with **no `batches` key at all**
 *   - the failure body carries no prose and no MES error text
 *   - the route does not collide with the Dummy MES's `/api/batches`
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

describe('the station\'s batch queue', () => {
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
    const response = await request(harness.app).get('/api/batch-queue');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  it('refuses the queue with a token that is not valid', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  // ── The queue ──

  it('returns the released queue to a signed-in operator', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.batches)).toBe(true);
    expect(response.body.batches.length).toBeGreaterThan(0);
  });

  it('displays all seven FR-1 columns on every row', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    for (const row of response.body.batches as unknown[]) {
      const batch = row as Record<string, unknown>;
      expect(Object.keys(batch).sort()).toEqual([
        'batchId',
        'componentCount',
        'fabricDescription',
        'machineRef',
        'orderRef',
        'shadeCode',
        'weighingStatus',
      ]);
      expect(typeof batch['batchId']).toBe('string');
      expect(typeof batch['orderRef']).toBe('string');
      expect(typeof batch['machineRef']).toBe('string');
      expect(typeof batch['shadeCode']).toBe('string');
      expect(typeof batch['componentCount']).toBe('number');
      expect(typeof batch['weighingStatus']).toBe('string');
    }
  });

  it('carries the time the queue was last received', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(typeof response.body.receivedAt).toBe('string');
    // A parseable ISO-8601 instant — the receipt time, not a bare date.
    expect(Number.isNaN(Date.parse(response.body.receivedAt as string))).toBe(
      false,
    );
  });

  it('carries the source, so a degraded read is attributable', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('DUMMY_ORGATEX');
  });

  it('carries a freshness marker on every response', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.freshness).toEqual({ kind: 'CURRENT' });
  });

  it('serves a queue whose rows match the MES\'s own queue', async () => {
    // The station's queue and the MES's queue are two projections of one
    // read, so they must agree — row for row.
    const station = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    const mes = await request(harness.app).get('/api/batches');

    expect(station.status).toBe(200);
    expect(mes.status).toBe(200);
    expect(station.body.batches.map((b: { batchId: string }) => b.batchId)).toEqual(
      mes.body.batches.map((b: { batchId: string }) => b.batchId),
    );
  });

  // ── The empty queue is NOT an error ──

  it('returns an empty queue as a 200 with zero rows and a receipt time', async () => {
    // An EMPTY world: the MES answers "nothing is released" — which is a
    // FACT, not a failure. The scenario is exercised through the real
    // seam, so the 200 is the seam's answer and not an injected row.
    const empty = createHarness({ orgatexWorld: new DummyOrgatexWorld([]) });
    try {
      await seedOperator(empty, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
      const signIn = await request(empty.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
      const emptyToken = signIn.body.token as string;

      const response = await request(empty.app)
        .get('/api/batch-queue')
        .set('Authorization', `Bearer ${emptyToken}`);

      expect(response.status).toBe(200);
      expect(response.body.batches).toEqual([]);
      // The receipt time is still displayed — "no work" is still a fact
      // about a queue that was received at a known time.
      expect(typeof response.body.receivedAt).toBe('string');
      expect(response.body.freshness).toEqual({ kind: 'CURRENT' });
    } finally {
      empty.close();
    }
  });

  // ── The failure is distinguishable ──

  it('fails loudly with a 503 when the MES is unreachable', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('BATCH_QUEUE_UNAVAILABLE');
    expect(response.body.reason).toBe('UNREACHABLE');
  });

  it('carries NO batches key on a failure — an empty queue is never substituted', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    // The ambiguity the story forbids: a `batches: []` in an error body
    // would be indistinguishable from "there is no work".
    expect(response.status).toBe(503);
    expect(response.body).not.toHaveProperty('batches');
  });

  it('never leaks the MES\'s error text to the client', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('Dummy OrgaTEX is unreachable');
    expect(body).not.toContain('unreachable');
    // The body carries codes only — no prose.
    expect(Object.keys(response.body).sort()).toEqual(['error', 'reason']);
  });

  // ── The degraded read is still a queue, marked with its age ──

  it('serves the last known-good queue with its age when the MES goes away', async () => {
    // One successful read, so the reader has a snapshot to fall back on.
    const first = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    // The clock moves, and the MES goes away.
    harness.clock.set(new Date('2026-10-30T08:02:00.000Z'));
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    // A degraded read is still a 200 — the operator is shown the queue,
    // marked with its age. It is NOT a 503.
    expect(response.status).toBe(200);
    expect(response.body.batches.length).toBeGreaterThan(0);
    // The age travels with the queue, so the UI never has to re-derive it.
    expect(response.body.freshness.kind).toBe('STALE');
    expect(response.body.freshness.ageMs).toBe(120_000);
  });

  it('serves the last known-good queue even after a restart of the read', async () => {
    // Two reads: the second is served from the reader's cache.
    await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.freshness.kind).toBe('STALE');
  });

  // ── The route does not collide with the Dummy MES ──

  it('does not shadow the Dummy MES\'s own /api/batches route', async () => {
    // The Dummy's batch-detail route is the trap: a queue route under
    // /api/batches would be captured by it and answered with a
    // batch-not-found.
    const mes = await request(harness.app).get('/api/batches/B-24187');
    expect(mes.status).toBe(200);
    expect(mes.body.batchId).toBe('B-24187');

    const queue = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    expect(queue.status).toBe(200);
  });
});
