/**
 * Integration tests for the identity API's EDGE CASES.
 *
 * The main integration suite covers the acceptance criteria. This file
 * covers the branches that a well-behaved client never reaches but an
 * attacker or a confused consumer will:
 *
 *   - malformed requests, and what they do and do not disclose;
 *   - sign-out through the body fallback, for clients that cannot set
 *     headers;
 *   - the ways a bearer token can be absent or unusable;
 *   - the 404 and error paths of the API surface.
 *
 * These are the paths where a careless implementation leaks information.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { extractBearerToken } from '../../src/008-operator-identity/presentation/middleware/resolve-current-operator.js';

describe('identity API edge cases', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, 'OP-001', 'R. Karim', 'OPERATOR', '4821');
  });

  afterEach(() => {
    harness.close();
  });

  describe('malformed sign-in requests', () => {
    it('rejects a missing secret with a VALIDATION_ERROR', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects a missing operator id with a VALIDATION_ERROR', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ secret: '4821' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty operator id', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: '', secret: '4821' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty secret', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects an over-long operator id', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'x'.repeat(65), secret: '4821' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects an over-long secret', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: 'x'.repeat(257) });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('names the offending FIELD, not the state of the credential store', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001' });

      expect(Array.isArray(res.body.fields)).toBe(true);
      const paths = res.body.fields.map((f: { path: string }) => f.path);
      expect(paths).toContain('secret');
    });

    it('a validation error does NOT disclose whether the operator exists', async () => {
      // The same malformed request against a KNOWN and an UNKNOWN
      // operator must produce the same answer. The request shape is
      // rejected before the credential store is consulted.
      const known = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001' });
      const unknown = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'GHOST-999' });

      expect(known.status).toBe(unknown.status);
      expect(known.text).toBe(unknown.text);
    });

    it('a validation error never contains the word AUTHENTICATION_FAILED', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001' });

      expect(JSON.stringify(res.body)).not.toContain('AUTHENTICATION_FAILED');
    });
  });

  describe('sign-out through the body fallback', () => {
    it('accepts a token in the body when no header is set', async () => {
      // Some clients cannot set headers. The body fallback exists for
      // them, and it must actually END the session.
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const out = await request(harness.app)
        .post('/api/identity/sign-out')
        .send({ token: signIn.body.token });

      expect(out.status).toBe(200);
      expect(out.body.signedOut).toBe(true);
      expect(out.body.sessionId).toBe(signIn.body.sessionId);

      const after = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${signIn.body.token}`);
      expect(after.status).toBe(401);
    });

    it('succeeds with NO token at all', async () => {
      const res = await request(harness.app).post('/api/identity/sign-out');

      expect(res.status).toBe(200);
      expect(res.body.signedOut).toBe(true);
      expect(res.body.sessionId).toBeNull();
    });

    it('succeeds with a malformed body', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-out')
        .send({ token: '' });

      expect(res.status).toBe(200);
      expect(res.body.signedOut).toBe(true);
    });

    it('succeeds with a body that has no token field at all', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-out')
        .send({ somethingElse: 'value' });

      expect(res.status).toBe(200);
      expect(res.body.signedOut).toBe(true);
    });

    it('succeeds with an unknown token in the body', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-out')
        .send({ token: 'never-issued-token' });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeNull();
    });

    it('PREFERS the header over the body', async () => {
      // If both are present, the header wins. Otherwise a caller could
      // sign out one session while appearing to sign out another.
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const out = await request(harness.app)
        .post('/api/identity/sign-out')
        .set('Authorization', `Bearer ${signIn.body.token}`)
        .send({ token: 'a-different-token' });

      expect(out.body.sessionId).toBe(signIn.body.sessionId);
    });
  });

  describe('bearer token extraction', () => {
    function reqWith(headers: Record<string, string>): Parameters<
      typeof extractBearerToken
    >[0] {
      return { headers } as never;
    }

    it('accepts a well-formed bearer header', () => {
      const token = extractBearerToken(reqWith({ authorization: 'Bearer abc123' }));
      expect(token).not.toBeNull();
      expect(token!.raw).toBe('abc123');
    });

    it('accepts a lowercase bearer scheme', () => {
      const token = extractBearerToken(reqWith({ authorization: 'bearer abc123' }));
      expect(token).not.toBeNull();
      expect(token!.raw).toBe('abc123');
    });

    it('rejects a non-bearer scheme', () => {
      expect(extractBearerToken(reqWith({ authorization: 'Basic abc123' }))).toBeNull();
    });

    it('rejects a missing header', () => {
      expect(extractBearerToken(reqWith({}))).toBeNull();
    });

    it('rejects an empty bearer value', () => {
      expect(extractBearerToken(reqWith({ authorization: 'Bearer ' }))).toBeNull();
    });

    it('rejects a whitespace-only bearer value', () => {
      expect(extractBearerToken(reqWith({ authorization: 'Bearer    ' }))).toBeNull();
    });

    it('rejects a header with no scheme', () => {
      expect(extractBearerToken(reqWith({ authorization: 'abc123' }))).toBeNull();
    });
  });

  describe('the session endpoints', () => {
    it('the session endpoint refuses a request with no token', async () => {
      const res = await request(harness.app).get('/api/identity/session');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('the session endpoint refuses an unknown token', async () => {
      const res = await request(harness.app)
        .get('/api/identity/session')
        .set('Authorization', 'Bearer never-issued-token');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('the current endpoint refuses a malformed Authorization header', async () => {
      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', 'Bearer');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('the current endpoint refuses a token that is only whitespace', async () => {
      const res = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', 'Bearer    ');

      expect(res.status).toBe(401);
    });
  });

  describe('the API surface', () => {
    it('returns 404 with a JSON body for an unknown route', async () => {
      const res = await request(harness.app).get('/api/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'NOT_FOUND' });
    });

    it('returns 404 for an unknown route under the identity prefix too', async () => {
      const res = await request(harness.app).get('/api/identity/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'NOT_FOUND' });
    });

    it('the health check needs no token', async () => {
      const res = await request(harness.app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('re-sign-in', () => {
    it('a new sign-in ends the previous session, and the old token is refused', async () => {
      const first = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      const second = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.token).not.toBe(second.body.token);

      const old = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${first.body.token}`);
      expect(old.status).toBe(401);

      const current = await request(harness.app)
        .get('/api/identity/current')
        .set('Authorization', `Bearer ${second.body.token}`);
      expect(current.status).toBe(200);
    });

    it('the previous session is ENDED, not deleted — the row remains', async () => {
      const first = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const rows = harness.identity.db
        .prepare('SELECT id, ended_at, ended_cause FROM identity_sessions')
        .all() as { id: string; ended_at: string | null; ended_cause: string | null }[];

      expect(rows.length).toBe(2);
      const ended = rows.find((r) => r.id === first.body.sessionId);
      expect(ended).toBeDefined();
      expect(ended!.ended_at).not.toBeNull();
      expect(ended!.ended_cause).toBe('REPLACED');
    });
  });
});
