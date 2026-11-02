/**
 * Security tests for the identity unit.
 *
 * This unit is the one the unit brief says has "the tightest security
 * requirement in the build" — "a defect here is not a usability bug, it is
 * a compliance breach". These tests are the enforcement.
 *
 * The four properties under test:
 *
 *   S1  A failed sign-in does not disclose whether the identity exists —
 *       in the response body, the status, OR the timing class.
 *   S2  The session token is opaque and is not recoverable from the store.
 *   S3  The credential store holds no plaintext secret.
 *   S4  The role is determined by the credential, never by the request.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { createApp } from '../../src/api/app.js';
import { buildScaleModule } from '../../src/004-scale-integration/infrastructure/composition-root.js';
import { Argon2SecretHasher } from '../../src/008-operator-identity/infrastructure/security/argon2-secret-hasher.js';
import { LocalIdentityProvider } from '../../src/008-operator-identity/infrastructure/security/local-identity-provider.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';

describe('security', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, 'OP-001', 'R. Karim', 'OPERATOR', '4821');
  });

  afterEach(() => {
    harness.close();
  });

  // ── S1a: the response must not disclose identity existence ─────────────
  describe('S1 — a failed sign-in does not disclose whether the identity exists', () => {
    it('returns identical STATUS for unknown-operator and wrong-secret', async () => {
      const wrongSecret = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '0000' });
      const unknownOperator = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'GHOST-999', secret: '4821' });

      expect(wrongSecret.status).toBe(unknownOperator.status);
      expect(wrongSecret.status).toBe(401);
    });

    it('returns a BYTE-IDENTICAL body for unknown-operator and wrong-secret', async () => {
      const wrongSecret = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '0000' });
      const unknownOperator = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'GHOST-999', secret: '4821' });

      expect(wrongSecret.text).toBe(unknownOperator.text);
      // And that body carries no field that distinguishes the two.
      expect(Object.keys(wrongSecret.body)).toEqual(['error']);
      expect(wrongSecret.body.error).toBe('AUTHENTICATION_FAILED');
    });

    it('returns identical bodies for a deactivated operator and a wrong secret', async () => {
      const { deactivateOperator } = await import('../harness.js');
      await deactivateOperator(harness, 'OP-001');

      const deactivated = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      const unknown = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'GHOST-999', secret: '4821' });

      expect(deactivated.text).toBe(unknown.text);
    });

    it('does not disclose existence through response TIMING', async () => {
      // The timing half of S1. The unknown-operator path must perform the
      // same KDF work as the wrong-secret path, or the endpoint is an
      // identity oracle that a stopwatch can read.
      //
      // This asserts an ORDER OF MAGNITUDE, not equality. A single-
      // threaded Node cannot fully equalise concurrent requests (see the
      // known limitation in the technical design), so requiring exact
      // equality would make this test flaky for a reason that is not a
      // defect. What matters is that neither path is an order of
      // magnitude cheaper than the other.
      const timePath = async (operatorId: string, secret: string): Promise<number> => {
        // Warm up so the first call's JIT and cache effects do not land
        // entirely on one path.
        await request(harness.app)
          .post('/api/identity/sign-in')
          .send({ operatorId, secret });

        const samples: number[] = [];
        for (let i = 0; i < 8; i++) {
          const started = process.hrtime.bigint();
          await request(harness.app)
            .post('/api/identity/sign-in')
            .send({ operatorId, secret });
          const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
          samples.push(elapsed);
        }
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)]!; // median
      };

      const wrongSecretMs = await timePath('OP-001', '0000');
      const unknownOperatorMs = await timePath('GHOST-999', '4821');

      const ratio = Math.max(wrongSecretMs, unknownOperatorMs) /
        Math.min(wrongSecretMs, unknownOperatorMs);

      expect(
        ratio,
        `wrong-secret took ${wrongSecretMs.toFixed(1)}ms, ` +
          `unknown-operator took ${unknownOperatorMs.toFixed(1)}ms — ` +
          `ratio ${ratio.toFixed(2)}x. A ratio near 1 means the paths do ` +
          `the same work; a large ratio means the endpoint is an oracle.`,
      ).toBeLessThan(2.5);
    });
  });

  // ── S1b: the provider must actually do the work on both paths ──────────
  describe('S1 — the provider performs the same work on both paths', () => {
    it('performs a verification on the unknown-operator path', async () => {
      // A counting hasher proves the work happens, independently of how
      // long it takes.
      const realHasher = new Argon2SecretHasher({
        memory: 8192,
        passes: 1,
        parallelism: 1,
        tagLength: 32,
        saltLength: 16,
      });

      let verifications = 0;
      const countingHasher = {
        hash: (s: string) => realHasher.hash(s),
        verify: (h: never, s: string) => {
          verifications++;
          return realHasher.verify(h, s);
        },
      };

      const provider = new LocalIdentityProvider(
        harness.identity.operatorRepository,
        harness.identity.credentialRepository,
        countingHasher,
      );

      // Unknown operator — must still verify.
      verifications = 0;
      const unknown = await provider.verifyCredential(
        OperatorId.create('GHOST-999'),
        'anything',
      );
      expect(unknown.isVerified()).toBe(false);
      expect(verifications).toBe(1);

      // Known operator, wrong secret — must verify too.
      verifications = 0;
      const wrong = await provider.verifyCredential(
        OperatorId.create('OP-001'),
        '0000',
      );
      expect(wrong.isVerified()).toBe(false);
      expect(verifications).toBeGreaterThanOrEqual(1);
    });
  });

  // ── S2: the session token is opaque and not recoverable ───────────────
  describe('S2 — the session token is opaque', () => {
    it('does not decode to the operator', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      const token: string = signIn.body.token;
      // It is not a JWT.
      expect(token.split('.')).toHaveLength(1);
      // It does not contain the operator id.
      expect(token).not.toContain('OP-001');
      expect(token).not.toContain('R. Karim');
      // It does not decode to JSON.
      expect(() => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))).toThrow();
    });

    it('is stored as a digest, never in plaintext', async () => {
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      const token: string = signIn.body.token;

      const rows = harness.identity.db
        .prepare('SELECT token_hash FROM identity_sessions')
        .all() as { token_hash: string }[];

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.token_hash).not.toBe(token);
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('two sessions have different tokens', async () => {
      const first = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });
      const second = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'SUP-001', secret: '9164' })
        .catch(() => null);

      expect(second).not.toBeNull();
      if (second) {
        expect(first.body.token).not.toBe(second.body.token);
      }
    });
  });

  // ── S3: no plaintext secret at rest ────────────────────────────────────
  describe('S3 — the credential store holds no plaintext secret', () => {
    it('stores argon2id hashes, not the secret', async () => {
      const rows = harness.identity.db
        .prepare('SELECT operator_id, secret_hash FROM credentials')
        .all() as { operator_id: string; secret_hash: string }[];

      expect(rows.length).toBe(1);
      expect(rows[0]!.secret_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]!.secret_hash).not.toContain('4821');
    });

    it('uses a DIFFERENT salt per credential, so one table is not one precomputed set', async () => {
      await seedOperator(harness, 'OP-002', 'T. Haque', 'OPERATOR', '4821');

      const rows = harness.identity.db
        .prepare('SELECT secret_hash FROM credentials ORDER BY operator_id')
        .all() as { secret_hash: string }[];

      const salts = rows.map((r) => r.secret_hash.split('$')[3]);
      expect(new Set(salts).size).toBe(rows.length);
    });

    it('the same secret hashed twice yields different hashes', () => {
      const hasher = new Argon2SecretHasher({
        memory: 8192,
        passes: 1,
        parallelism: 1,
        tagLength: 32,
        saltLength: 16,
      });
      expect(hasher.hash('same').encoded).not.toBe(hasher.hash('same').encoded);
    });

    it('verifies a correct secret and rejects a wrong one', () => {
      const hasher = new Argon2SecretHasher({
        memory: 8192,
        passes: 1,
        parallelism: 1,
        tagLength: 32,
        saltLength: 16,
      });
      const hash = hasher.hash('correct');
      expect(hasher.verify(hash, 'correct')).toBe(true);
      expect(hasher.verify(hash, 'wrong')).toBe(false);
    });

    it('uses the FULL cost profile from ADR-001', () => {
      // The reduced test profile is for speed; the shipped profile must be
      // the documented one.
      const hasher = new Argon2SecretHasher();
      const hash = hasher.hash('x');
      expect(hash.algorithm).toBe('argon2id');
      expect(hash.parameters.memory).toBe(19456);
      expect(hash.parameters.passes).toBe(2);
      expect(hash.parameters.parallelism).toBe(1);
      expect(hash.parameters.tagLength).toBe(32);
    });
  });

  // ── S4: the role comes from the credential ─────────────────────────────
  describe('S4 — the role is determined by the credential', () => {
    it('ignores a role requested in the body', async () => {
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821', role: 'SUPERVISOR' });
      expect(res.body.operator.role).toBe('OPERATOR');
    });

    it('a SUPERVISOR credential yields the SUPERVISOR role', async () => {
      await seedOperator(harness, 'SUP-001', 'S. Ahmed', 'SUPERVISOR', '9164');
      const res = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'SUP-001', secret: '9164' });
      expect(res.body.operator.role).toBe('SUPERVISOR');
    });

    it('signing in grants NO supervisor privilege on its own', async () => {
      // The unit brief: "Signing in alone grants no supervisor privilege".
      // An OPERATOR session must not carry any privilege marker.
      const signIn = await request(harness.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: 'OP-001', secret: '4821' });

      expect(signIn.body).not.toHaveProperty('privilege');
      expect(signIn.body).not.toHaveProperty('authorisation');
      expect(signIn.body).not.toHaveProperty('canOverride');
    });

    it('the database CHECK constraint rejects a role outside the set', () => {
      // The role set is enforced by the type AND by the storage layer.
      expect(() =>
        harness.identity.db
          .prepare(
            `INSERT INTO operators (id, display_name, role, active, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('EVIL-1', 'E. Vil', 'ADMIN', 1, new Date().toISOString()),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  // ── session lifetime and configuration ─────────────────────────────────
  describe('session lifetime', () => {
    it('honours a configured lifetime', async () => {
      const shortLived = createHarness({ sessionLifetimeMs: 1000 });
      try {
        await seedOperator(shortLived, 'OP-001', 'R. Karim', 'OPERATOR', '4821');
        const signIn = await request(shortLived.app)
          .post('/api/identity/sign-in')
          .send({ operatorId: 'OP-001', secret: '4821' });

        shortLived.clock.advance(1001);

        const res = await request(shortLived.app)
          .get('/api/identity/current')
          .set('Authorization', `Bearer ${signIn.body.token}`);
        expect(res.status).toBe(401);
      } finally {
        shortLived.close();
      }
    });
  });

  // ── the Q-08 seam ──────────────────────────────────────────────────────
  describe('the IdentityProvider seam', () => {
    it('exposes LOCAL as the current provider', () => {
      expect(harness.identity.provider.kind).toBe('LOCAL');
    });

    it('the seam is swappable — a different provider changes nothing else', async () => {
      // The whole point of Q-08: if FCI supplies a directory, only the
      // provider is replaced. This test proves the module can be built
      // with an injected provider.
      const { buildIdentityModule } = await import(
        '../../src/008-operator-identity/infrastructure/composition-root.js'
      );

      const stub = {
        kind: 'DIRECTORY' as const,
        available: async () => true,
        findOperator: async () => null,
        verifyCredential: async () => {
          const { VerificationOutcome } = await import(
            '../../src/008-operator-identity/domain/services/identity-provider.js'
          );
          return VerificationOutcome.failed();
        },
        describe: () => 'Stub directory provider',
      };

      const module = buildIdentityModule({
        config: {
          databasePath: ':memory:',
          sessionLifetimeMs: 60000,
          argon2Memory: 8192,
          argon2Passes: 1,
          authorisationLifetimeMs: 900000,
        },
        provider: stub,
      });

      try {
        expect(module.provider.kind).toBe('DIRECTORY');
        const res = await request(module.provider && createAppFor(module))
          .post('/api/identity/sign-in')
          .send({ operatorId: 'OP-001', secret: '4821' });
        // The API contract is unchanged: still one failure response.
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'AUTHENTICATION_FAILED' });
      } finally {
        module.close();
      }
    });
  });
});

// Local helper so the seam test can mount an app over an injected provider.
function createAppFor(module: ReturnType<
  typeof import('../../src/008-operator-identity/infrastructure/composition-root.js').buildIdentityModule
>) {
  return createApp({
    identity: module,
    scales: buildScaleModule({
      config: {
        databasePath: ':memory:',
        disconnectTimeoutMs: 2000,
        sampleIntervalMs: 100,
        selectionThreshold: null,
      },
      db: module.db,
    }),
  });
}
