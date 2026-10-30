/**
 * Integration tests for the API surface — CORS, the error handler, and
 * the security headers the application sets on itself.
 *
 * These are properties of the SHARED HTTP shell rather than of the
 * identity unit, but they live in `src/api/app.ts` and they govern how
 * every other unit's endpoints will behave. Testing them here means the
 * next bolt inherits a shell that is already known to work.
 *
 * The CORS rules matter for a specific reason: the session token is a
 * BEARER credential. If a wildcard origin could read a response, any
 * page the operator visited could exfiltrate their token. The origin list
 * is therefore explicit and closed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createHarness, seedOperator, type Harness } from '../harness.js';
import { createApp } from '../../src/api/app.js';

describe('the API surface', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, 'OP-001', 'R. Karim', 'OPERATOR', '4821');
  });

  afterEach(() => {
    harness.close();
  });

  describe('CORS', () => {
    it('allows the configured SPA origin', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(res.headers['vary']).toBe('Origin');
    });

    it('allows the loopback SPA origin too', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'http://127.0.0.1:5173');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1:5173',
      );
    });

    it('does NOT allow an unknown origin', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'https://evil.example.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does NOT allow a wildcard origin', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'https://evil.example.com');

      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('advertises the allowed headers and methods', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-headers']).toContain(
        'Authorization',
      );
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('answers a preflight request with 204 and no body', async () => {
      const res = await request(harness.app)
        .options('/api/identity/sign-in')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
    });

    it('answers a preflight from an unknown origin with 204 and no CORS grant', async () => {
      const res = await request(harness.app)
        .options('/api/identity/sign-in')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('honours an EXPLICIT origin list', async () => {
      // The origin list is configuration, not a constant. A deployment
      // serving the SPA from another host must be able to change it
      // without a code change.
      const restricted = createApp({
        identity: harness.identity,
        corsOrigins: ['https://weighingms.internal'],
      });

      const allowed = await request(restricted)
        .get('/api/health')
        .set('Origin', 'https://weighingms.internal');
      expect(allowed.headers['access-control-allow-origin']).toBe(
        'https://weighingms.internal',
      );

      const denied = await request(restricted)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('the security headers of the shell', () => {
    it('does not advertise the framework', async () => {
      const res = await request(harness.app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('the error handler', () => {
    it('returns a generic INTERNAL_ERROR and never the detail', async () => {
      // The detail goes to the log, never to the client. An error message
      // can carry a SQL fragment, a file path, or a stack — none of which
      // should cross the boundary.
      //
      // The route is registered on a bare Express app carrying the SAME
      // error-handler shape as `createApp`. Registering it on the real
      // app would not work: the 404 catch-all is already in the stack,
      // and Express matches in registration order.
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exploding = express();
        exploding.get('/api/boom', () => {
          throw new Error('secret internal detail: /var/data/weighingms.sqlite');
        });
        exploding.use(
          (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
          ): void => {
            console.error('[api] unhandled error:', err);
            if (res.headersSent) return;
            res.status(500).json({ error: 'INTERNAL_ERROR' });
          },
        );

        const res = await request(exploding).get('/api/boom');

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
        expect(res.text).not.toContain('secret internal detail');
        expect(res.text).not.toContain('weighingms.sqlite');
      } finally {
        errorLog.mockRestore();
      }
    });

    it('LOGGS the detail even though it does not return it', async () => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exploding = express();
        exploding.get('/api/boom', () => {
          throw new Error('boom detail');
        });
        exploding.use(
          (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
          ): void => {
            console.error('[api] unhandled error:', err);
            if (res.headersSent) return;
            res.status(500).json({ error: 'INTERNAL_ERROR' });
          },
        );

        await request(exploding).get('/api/boom');

        expect(errorLog).toHaveBeenCalled();
        // The handler logs a label and the error object — the detail is
        // in the second argument, not the first.
        const logged = errorLog.mock.calls
          .map((call) => call.map((arg) => String(arg)).join(' '))
          .join(' ');
        expect(logged).toContain('boom detail');
      } finally {
        errorLog.mockRestore();
      }
    });

    it('the REAL app turns an oversized body into a generic 500, not a body-parser leak', async () => {
      // The 16 kb limit is enforced by the body parser, which throws
      // before any handler runs. The error handler catches it and returns
      // the generic shape — the parser's own message never reaches the
      // client.
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const res = await request(harness.app)
          .post('/api/identity/sign-in')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ operatorId: 'OP-001', secret: 'x'.repeat(20_000) }));

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
        expect(res.text).not.toContain('entity too large');
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  describe('the protected probe route', () => {
    it('reports the signed-in operator', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const res = await request(harness.app)
        .get('/api/identity/protected-probe')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.operator.operatorId).toBe('OP-001');
      expect(res.body.operator.displayName).toBe('R. Karim');
      expect(res.body.operator.role).toBe('OPERATOR');
    });

    it('refuses an expired session', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      harness.clock.advance(2 * 60 * 60 * 1000);

      const res = await request(harness.app)
        .get('/api/identity/protected-probe')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });

    it('refuses a session whose operator has been deactivated', async () => {
      // Deactivation takes effect immediately, even for an already-live
      // session — that is why it is checked on every authorisation.
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const { deactivateOperator } = await import('../harness.js');
      await deactivateOperator(harness, 'OP-001');

      const res = await request(harness.app)
        .get('/api/identity/protected-probe')
        .set('Authorization', `Bearer ${signIn.body.token}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    });
  });
});
