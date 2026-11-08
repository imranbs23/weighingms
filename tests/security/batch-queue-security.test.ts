/**
 * The station's batch queue — security properties.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   S1  The station's queue is NOT readable without an operator session.
 *   S2  The session must be LIVE — an ended session is refused.
 *   S3  A failed read never substitutes an empty queue for "unknown".
 *   S4  The MES's internal message never reaches the client.
 *   S5  The response carries CODES, not prose — the UI owns the text.
 *   S6  The queue is not reachable through the Dummy MES's open surface
 *       with the station's own contract.
 *   S7  The endpoint takes no input, so there is no injectable parameter.
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

describe('the station\'s batch queue — security', () => {
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

  // ── S1 ──

  it('refuses the queue without a session', async () => {
    const response = await request(harness.app).get('/api/batch-queue');
    expect(response.status).toBe(401);
  });

  it('refuses the queue with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('refuses the queue with a token of the wrong shape', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', 'Basic abcdef');
    expect(response.status).toBe(401);
  });

  // ── S2 ──

  it('refuses the queue once the session has ENDED', async () => {
    await request(harness.app)
      .post('/api/identity/sign-out')
      .set('Authorization', `Bearer ${token}`);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  // ── S3 ──

  it('never substitutes an empty queue for a failed read', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body).not.toHaveProperty('batches');
  });

  // ── S4 ──

  it('never leaks the MES\'s internal message to the client', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('The Dummy OrgaTEX is unreachable');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('at ');
  });

  // ── S5 ──

  it('emits codes, not prose — the UI owns the text', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    // The payload is data and codes. Every string in it is a value the MES
    // supplied or a code — none of them is operator-facing prose.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('Queue received');
    expect(body).not.toContain('no released batches');
    expect(body).not.toContain('error');
  });

  it('carries no prose on the failure path either', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(Object.keys(response.body).sort()).toEqual(['error', 'reason']);
  });

  // ── S6 ──

  it('does not expose the station\'s contract through the Dummy MES\'s open surface', async () => {
    // The Dummy MES's endpoints are open by design — the MES is the
    // external system. What must not happen is the STATION's contract
    // (its receipt time, its source, its freshness) being reachable
    // without a session.
    const response = await request(harness.app).get('/api/batches');

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('receivedAt');
    expect(response.body).not.toHaveProperty('freshness');
    expect(response.body).not.toHaveProperty('source');
  });

  // ── S7 ──

  it('refuses an unknown status instead of silently showing everything', async () => {
    // Bolt 009 gave the endpoint a `status` parameter, so the endpoint
    // now HAS an input — and the input is validated against the MES's
    // closed status set. An unrecognised status is a `400`, never a
    // silently widened answer: the story forbids mapping a status the
    // MES does not know onto "All" (ADR-030).
    const response = await request(harness.app)
      .get('/api/batch-queue?status=NOT_A_STATUS')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(response.body).not.toHaveProperty('batches');
  });

  it('refuses an EMPTY status rather than reading it as "All"', async () => {
    // "All" has exactly one spelling: an ABSENT parameter. An empty
    // string is a client that sent a status, and it was not one.
    const response = await request(harness.app)
      .get('/api/batch-queue?status=')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('batches');
  });

  it('refuses a REPEATED status — a filter holds exactly one', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue?status=RELEASED&status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('batches');
  });

  it('does not let a query parameter reach the seam unvalidated', async () => {
    // The parameter is compared against a CLOSED SET before it is used.
    // It is never interpolated into a query, a log line or a path — so
    // there is no injection surface, and nothing to sanitise.
    const response = await request(harness.app)
      .get("/api/batch-queue?status=RELEASED'; DROP TABLE batch_selections;--")
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('DROP TABLE');
  });
});
