/**
 * Integration tests for the identity API.
 *
 * These exercise the REAL stack — real Argon2id, real SQLite, real
 * Express — through Supertest. There are no mocks, because the property
 * under test is precisely that the real stack behaves this way.
 *
 * The tests map one-to-one onto the story's acceptance criteria, so a
 * failure names the criterion it breaks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  deactivateOperator,
  type Harness,
} from '../harness.js';

describe('identity API', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, 'OP-001', 'R. Karim', 'OPERATOR', '4821');
    await seedOperator(harness, 'SUP-001', 'S. Ahmed', 'SUPERVISOR', '9164');
  });

  afterEach(() => {
    harness.close();
  });

  // ── AC 1: a session carries id, displayName, role, method, time ────────
  describe('sign-in', () => {
    it('establishes a session carrying the operator identity', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      expect(res.status).toBe(200);
      expect(res.body.operator).toEqual({
        operatorId: 'OP-001',
        displayName: 'R. Karim',
        role: 'OPERATOR',
      });
      expect(res.body.token).toBeTypeOf('string');
      expect(res.body.sessionId).toBeTypeOf('string');
      expect(res.body.method).toBe('LOCAL');
      expect(res.body.authenticatedAt).toBeTypeOf('string');
      expect(res.body.expiresAt).toBeTypeOf('string');
    });

    it('returns the SUPERVISOR role for a supervisor credential', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'SUP-001', secret: '9164' });

      expect(res.status).toBe(200);
      expect(res.body.operator.role).toBe('SUPERVISOR');
    });

    it('rejects a wrong secret', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '0000' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'AUTHENTICATION_FAILED' });
    });

    it('rejects an unknown operator', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'NOPE-999', secret: '4821' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'AUTHENTICATION_FAILED' });
    });

    it('rejects a deactivated operator', async () => {
      await deactivateOperator(harness, 'OP-001');
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'AUTHENTICATION_FAILED' });
    });

    it('rejects a malformed body with a VALIDATION_ERROR, not an auth error', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      // The detail describes the REQUEST, never the credential store.
      expect(JSON.stringify(res.body)).not.toContain('AUTHENTICATION_FAILED');
    });

    it('ends an existing session when the same operator signs in again', async () => {
      // The terminal is single-operator: a new sign-in ends the old one.
      const first = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      expect(first.status).toBe(200);

      const second = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      expect(second.status).toBe(200);

      const old = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${first.body.token}`);
      expect(old.status).toBe(401);

      const current = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${second.body.token}`);
      expect(current.status).toBe(200);
    });
  });

  // ── AC 2: the current operator is available to other units ────────────
  describe('current operator', () => {
    it('returns the operator for a valid session', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.operator.operatorId).toBe('OP-001');
      expect(res.body.operator.displayName).toBe('R. Karim');
    });

    it('refuses with no token', async () => {
      const res = await request(harness.app).get('/api/identity/current');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('refuses a tampered token', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token.slice(0, -4)}XXXX`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('refuses a truncated token', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token.slice(0, 10)}`);

      expect(res.status).toBe(401);
    });

    it('refuses a non-bearer Authorization header', async () => {
      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(res.status).toBe(401);
    });
  });

  // ── AC 3: sign-out ends the session ────────────────────────────────────
  describe('sign-out', () => {
    it('ends the session so it authorises nothing afterwards', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const out = await request(harness.app)
        .post('/api/identity/sign-out')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(out.status).toBe(200);
      expect(out.body.signedOut).toBe(true);

      const after = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(after.status).toBe(401);
    });

    it('is idempotent', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const first = await request(harness.app)
        .post('/api/identity/sign-out')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      const second = await request(harness.app)
        .post('/api/identity/sign-out')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it('succeeds with an unknown token — failing would disclose validity', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-out')
        .set('Authorization', 'Bearer never-issued-token');
      expect(res.status).toBe(200);
    });
  });

  // ── AC 4: an expired session authorises nothing ────────────────────────
  describe('session expiry', () => {
    it('refuses a session whose expiry has passed', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      // Advance past the expiry.
      harness.clock.advance(2 * 60 * 60 * 1000);

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(res.status).toBe(401);
    });

    it('refuses a session AT the expiry instant (inclusive boundary)', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      harness.clock.advance(60 * 60 * 1000); // exactly the lifetime

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(res.status).toBe(401);
    });

    it('still allows a session one millisecond before expiry', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      harness.clock.advance(60 * 60 * 1000 - 1);

      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(res.status).toBe(200);
    });
  });

  // ── AC 8: an operator-only action is refused when anonymous ───────────
  describe('protected routes', () => {
    it('refuses an anonymous request', async () => {
      const res = await request(harness.app).get('/api/identity/protected-probe');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('allows a signed-in operator and reports their identity', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/protected-probe')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.operator.operatorId).toBe('OP-001');
      expect(res.body.operator.role).toBe('OPERATOR');
    });
  });

  // ── AC 9: the role comes from the credential, never the request ────────
  describe('role authority', () => {
    it('ignores a client-requested role', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821', role: 'SUPERVISOR' });

      expect(res.status).toBe(200);
      expect(res.body.operator.role).toBe('OPERATOR');
    });

    it('ignores a client-requested role of supervisor in any casing', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821', role: 'supervisor' });

      expect(res.body.operator.role).toBe('OPERATOR');
    });
  });

  // ── the session endpoint reports the session's own fields ──────────────
  describe('session endpoint', () => {
    it('reports the session fields', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/session')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.operatorId).toBe('OP-001');
      expect(res.body.role).toBe('OPERATOR');
      expect(res.body.method).toBe('LOCAL');
      expect(res.body.sessionId).toBe(signIn.body.sessionId);
    });
  });

  // ── misc API behaviour ─────────────────────────────────────────────────
  describe('general', () => {
    it('answers the health check', async () => {
      const res = await request(harness.app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('returns 404 for an unknown route', async () => {
      const res = await request(harness.app).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'NOT_FOUND' });
    });
  });
});
