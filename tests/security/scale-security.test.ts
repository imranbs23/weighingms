/**
 * Security tests for the scale unit's HTTP boundary.
 *
 * THE TWO RULES UNDER TEST
 * ------------------------
 *   ADR-013  the READ endpoints are open; the TRAINING CONTROLS are not
 *   ADR-004  the identity unit's uniform-refusal rule does NOT apply
 *             here, and the difference is deliberate
 *
 * WHY ADR-004 DOES NOT APPLY HERE
 * --------------------------------
 * ADR-004 made every authorisation refusal return ONE identical body,
 * because a distinguishable response is an enumeration oracle over
 * supervisor identities — and a supervisor's credential is SECRET.
 *
 * A scale's state is not secret. The operator can see the scale in front
 * of them. Distinguishing "disconnected" from "calibration expired" is
 * not an information leak — it is the story's acceptance criterion: "a
 * stated reason identifies the scale as disconnected".
 *
 * So the two units' refusal vocabularies differ ON PURPOSE, and these
 * tests hold that difference in place rather than letting one unit's
 * rule be applied to the other by accident.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const SCALE = 'SCALE-A';

describe('Scale boundary security', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  // ── The read endpoints are open (ADR-013) ──

  it('serves the scale list without a session', async () => {
    const res = await request(harness.app).get('/api/scales');
    expect(res.status).toBe(200);
  });

  it('serves the status view without a session', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/status`);
    expect(res.status).toBe(200);
  });

  it('serves the weighing gate without a session', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/can-weigh`);
    expect(res.status).toBe(200);
  });

  it('does not leak a credential in the open responses', async () => {
    const res = await request(harness.app).get('/api/scales');
    expect(res.text).not.toMatch(/password|secret|token|credential/i);
  });

  // ── The training controls are guarded ──

  it('refuses the link control without a session', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .send({ state: 'DISCONNECTED' });
    expect(res.status).toBe(401);
  });

  it('refuses the dispense control without a session', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .send({ target: '1000', tolerance: '10', landing: 'IN_TOLERANCE' });
    expect(res.status).toBe(401);
  });

  it('refuses the link control with a MALFORMED token', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ state: 'DISCONNECTED' });
    expect(res.status).toBe(401);
  });

  it('refuses the link control with an unknown but well-formed token', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .set('Authorization', 'Bearer 0123456789abcdef0123456789abcdef')
      .send({ state: 'DISCONNECTED' });
    expect(res.status).toBe(401);
  });

  // ── The body is validated, not trusted ──

  it('rejects an oversized body without disclosing why', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(harness.app)
        .post(`/api/scales/${SCALE}/dispense`)
        .set('Authorization', `Bearer ${token}`)
        .send({ target: '1'.repeat(32 * 1024), tolerance: '10', landing: 'IN_TOLERANCE' });

      // The product's ESTABLISHED contract: every unhandled error
      // returns one generic body, and the detail goes to the log. The
      // identity unit decided this deliberately, and the scale unit
      // does not get a more informative error than it.
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
      expect(res.text).not.toContain('entity too large');
      expect(res.text).not.toContain('limit');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects a scale id that is not a valid identifier', async () => {
    const res = await request(harness.app).get(`/api/scales/${'x'.repeat(200)}/status`);
    expect(res.status).toBe(400);
  });

  it('rejects an exponent-shaped quantity — it is a float notation', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: '1e3', tolerance: '10', landing: 'IN_TOLERANCE' });

    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric quantity', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 'lots', tolerance: '10', landing: 'IN_TOLERANCE' });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown landing mode', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: '1000', tolerance: '10', landing: 'WHATEVER' });

    expect(res.status).toBe(400);
  });

  // ── The named reason is not a leak of a SECRET ──

  it('names the disconnection reason — the story REQUIRES it', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/can-weigh`);

    // A scale's state is visible at the station. The reason is required
    // by the acceptance criteria, and it discloses nothing secret.
    expect(res.body.reason).toBe('SCALE_NOT_RESPONDING');
  });

  it('names only device facts — never an identity', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/can-weigh`);

    expect(res.text).not.toMatch(/operator|supervisor|badge|identity/i);
  });

  // ── The scale endpoints do not shadow the identity endpoints ──

  it('does not let a scale path reach the identity routes', async () => {
    const res = await request(harness.app).post('/api/scales/../identity/sign-in');
    // Whatever the router does with the traversal, it must not
    // authenticate anyone.
    expect(res.status).not.toBe(200);
  });
});
