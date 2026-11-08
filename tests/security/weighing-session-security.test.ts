/**
 * The weighing session — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR NEVER CHOOSES THE SCALE, AND NEVER POSTS A WEIGHT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 003's session.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - a client-supplied scaleId is DROPPED — the rule chooses
 *   - there is NO endpoint that accepts a weight
 *   - the diagnostics never reach the client (BRD IR-09)
 *   - the state machine is not client-writable
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

describe('the weighing session — security', () => {
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

  it('refuses the selection without a session', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('refuses the selection with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('does NOT require a SUPERVISOR — selecting a component authorises nothing', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(200);
  });

  it('DROPS a client-supplied scaleId — the RULE chooses', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', scaleId: 'SCALE-B' });

    expect(response.status).toBe(200);
    // The 94 g component demands PRECISION, so the rule chose SCALE-A —
    // whatever the client asked for.
    expect(response.body.scaleId).toBe('SCALE-A');
  });

  it('has NO endpoint that accepts a weight', async () => {
    for (const path of [
      '/api/session/weight',
      '/api/session/reading',
    ]) {
      const response = await request(harness.app)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '94.0000', unit: 'g', stable: true });

      // A `GET` path answers `404` to a `POST`; an unknown path answers
      // `404` too. Either way, **no weight was accepted**.
      expect(response.status).toBe(404);
    }
  });

  it('has NO endpoint that sets the session’s state', async () => {
    for (const path of ['/api/session', '/api/session/state']) {
      const response = await request(harness.app)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ state: 'COMPLETE' });

      expect(response.status).toBe(404);
    }
  });

  it('carries no prose in the 200 body', async () => {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(200);
    expect(typeof response.body.session.state).toBe('string');
    expect(response.body.session.state).not.toContain(' ');
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(harness.app)
        .post('/api/session/select')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: 'NOPE' });

      expect(response.status).toBe(404);
      // The body carries the CODE, not the component id and not a
      // sentence.
      expect(Object.keys(response.body)).toEqual(['error']);
      expect(response.text).not.toContain('NOPE');
    } finally {
      errorLog.mockRestore();
    }
  });
});
