/**
 * Integration tests for the persistence adapters.
 *
 * These run against a REAL SQLite database (in memory) rather than a mock,
 * because the properties under test are properties of the ADAPTERS and of
 * the SCHEMA:
 *
 *   - a value survives a round trip through the database unchanged;
 *   - a session token is NOT recoverable from the stored row;
 *   - the schema's constraints actually reject bad data;
 *   - migrations are applied exactly once and are idempotent.
 *
 * A mocked repository would prove none of that. It would only prove that
 * the mock agrees with itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDatabase,
  type SqliteDatabase,
} from '../../src/008-operator-identity/infrastructure/persistence/database.js';
import { SqliteOperatorRepository } from '../../src/008-operator-identity/infrastructure/persistence/sqlite-operator-repository.js';
import { SqliteCredentialRepository } from '../../src/008-operator-identity/infrastructure/persistence/sqlite-credential-repository.js';
import {
  SqliteSessionRepository,
  hashSessionToken,
} from '../../src/008-operator-identity/infrastructure/persistence/sqlite-session-repository.js';
import { Operator } from '../../src/008-operator-identity/domain/entities/operator.js';
import { Credential } from '../../src/008-operator-identity/domain/entities/credential.js';
import { IdentitySession } from '../../src/008-operator-identity/domain/entities/identity-session.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { SecretHash } from '../../src/008-operator-identity/domain/value-objects/secret-hash.js';
import { SessionToken } from '../../src/008-operator-identity/domain/value-objects/session-token.js';
import { AuthenticationMethod } from '../../src/008-operator-identity/domain/value-objects/authentication-method.js';

const NOW = new Date('2026-10-30T08:00:00.000Z');
const LATER = new Date('2026-10-30T16:00:00.000Z');
const ENCODED =
  '$argon2id$m=19456,t=2,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';

describe('the persistence adapters', () => {
  let db: SqliteDatabase;
  let operators: SqliteOperatorRepository;
  let credentials: SqliteCredentialRepository;
  let sessions: SqliteSessionRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    operators = new SqliteOperatorRepository(db);
    credentials = new SqliteCredentialRepository(db);
    sessions = new SqliteSessionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('the operator repository', () => {
    it('round-trips an operator', async () => {
      const operator = new Operator(
        OperatorId.create('OP-001'),
        'R. Karim',
        OperatorRole.operator(),
        true,
        NOW,
      );
      await operators.save(operator);

      const found = await operators.findById(OperatorId.create('OP-001'));

      expect(found).not.toBeNull();
      expect(found!.id.value).toBe('OP-001');
      expect(found!.displayName).toBe('R. Karim');
      expect(found!.role.value).toBe('OPERATOR');
      expect(found!.active).toBe(true);
      expect(found!.createdAt).toEqual(NOW);
    });

    it('returns null for an unknown operator', async () => {
      expect(await operators.findById(OperatorId.create('NOPE'))).toBeNull();
    });

    it('UPDATES rather than duplicating when saved twice', async () => {
      const operator = new Operator(
        OperatorId.create('OP-001'),
        'R. Karim',
        OperatorRole.operator(),
        true,
        NOW,
      );
      await operators.save(operator);
      await operators.save(operator.rename('R. Karim-Lutfi').deactivate());

      const all = await operators.findAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.displayName).toBe('R. Karim-Lutfi');
      expect(all[0]!.active).toBe(false);
    });

    it('preserves the SUPERVISOR role', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('SUP-001'),
          'S. Ahmed',
          OperatorRole.supervisor(),
          true,
          NOW,
        ),
      );

      const found = await operators.findById(OperatorId.create('SUP-001'));
      expect(found!.role.value).toBe('SUPERVISOR');
      expect(found!.isSupervisor()).toBe(true);
    });

    it('lists operators ordered by id', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-002'),
          'T. Haque',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );

      const all = await operators.findAll();
      expect(all.map((o) => o.id.value)).toEqual(['OP-001', 'OP-002']);
    });
  });

  describe('the credential repository', () => {
    beforeEach(async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
    });

    it('round-trips a credential', async () => {
      await credentials.save(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(ENCODED),
          NOW,
        ),
      );

      const found = await credentials.findByOperatorAndRole(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
      );

      expect(found).not.toBeNull();
      expect(found!.secretHash.encoded).toBe(ENCODED);
      expect(found!.secretHash.algorithm).toBe('argon2id');
      expect(found!.secretHash.parameters.memory).toBe(19456);
      expect(found!.rotatedAt).toEqual(NOW);
    });

    it('returns null for an unknown operator or role', async () => {
      expect(
        await credentials.findByOperatorAndRole(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
        ),
      ).toBeNull();
      expect(
        await credentials.findByOperatorAndRole(
          OperatorId.create('GHOST'),
          OperatorRole.operator(),
        ),
      ).toBeNull();
    });

    it('replaces the hash on rotation rather than adding a second row', async () => {
      const rotated = '$argon2id$m=65536,t=3,p=1$bmV3c2FsdA==$bmV3aGFzaG5ld2JoZXJl';
      await credentials.save(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(ENCODED),
          NOW,
        ),
      );
      await credentials.save(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(rotated),
          LATER,
        ),
      );

      const all = await credentials.findByOperator(OperatorId.create('OP-001'));
      expect(all).toHaveLength(1);
      expect(all[0]!.secretHash.encoded).toBe(rotated);
      expect(all[0]!.secretHash.parameters.memory).toBe(65536);
      expect(all[0]!.rotatedAt).toEqual(LATER);
    });

    it('stores the hash and NEVER a plaintext secret', async () => {
      await credentials.save(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(ENCODED),
          NOW,
        ),
      );

      const row = db
        .prepare('SELECT secret_hash FROM credentials WHERE operator_id = ?')
        .get('OP-001') as { secret_hash: string };

      expect(row.secret_hash).toBe(ENCODED);
      expect(row.secret_hash).not.toContain('4821');
    });
  });

  describe('the session repository', () => {
    beforeEach(async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
    });

    function makeSession(
      token: string,
      overrides?: { id?: string; expiresAt?: Date; authenticatedAt?: Date },
    ): IdentitySession {
      return new IdentitySession(
        overrides?.id ?? 'session-1',
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        AuthenticationMethod.local(),
        new SessionToken(token),
        overrides?.authenticatedAt ?? NOW,
        overrides?.expiresAt ?? LATER,
      );
    }

    it('round-trips a session', async () => {
      await sessions.save(makeSession('token-value'));

      const found = await sessions.findByToken(new SessionToken('token-value'));

      expect(found).not.toBeNull();
      expect(found!.id).toBe('session-1');
      expect(found!.operatorId.value).toBe('OP-001');
      expect(found!.role.value).toBe('OPERATOR');
      expect(found!.method.value).toBe('LOCAL');
      expect(found!.authenticatedAt).toEqual(NOW);
      expect(found!.expiresAt).toEqual(LATER);
      expect(found!.endedAt).toBeNull();
    });

    it('does NOT recover the raw token from the stored row', async () => {
      // ADR-002: the token is stored as a SHA-256 digest. A reader of the
      // database must not be able to reconstruct the bearer token.
      await sessions.save(makeSession('super-secret-token'));

      const row = db
        .prepare('SELECT token_hash FROM identity_sessions')
        .get() as { token_hash: string };

      expect(row.token_hash).not.toBe('super-secret-token');
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).toBe(hashSessionToken(new SessionToken('super-secret-token')));
    });

    it('the recovered session carries a placeholder, not the real token', async () => {
      await sessions.save(makeSession('super-secret-token'));

      const found = await sessions.findByToken(new SessionToken('super-secret-token'));

      expect(found!.token.raw).not.toBe('super-secret-token');
      expect(found!.token.raw).toBe('stored:session-1');
    });

    it('returns null for an unknown token', async () => {
      expect(
        await sessions.findByToken(new SessionToken('never-issued')),
      ).toBeNull();
    });

    it('returns null for a TAMPERED token', async () => {
      await sessions.save(makeSession('super-secret-token'));

      expect(
        await sessions.findByToken(new SessionToken('super-secret-tokeN')),
      ).toBeNull();
    });

    it('returns null for a TRUNCATED token', async () => {
      await sessions.save(makeSession('super-secret-token'));

      expect(
        await sessions.findByToken(new SessionToken('super-sec')),
      ).toBeNull();
    });

    it('ENDS a session — it never deletes the row', async () => {
      await sessions.save(makeSession('token-value'));

      await sessions.end('session-1', LATER, 'SIGNED_OUT');

      const row = db
        .prepare('SELECT ended_at, ended_cause FROM identity_sessions WHERE id = ?')
        .get('session-1') as { ended_at: string; ended_cause: string };

      expect(row.ended_at).toBe(LATER.toISOString());
      expect(row.ended_cause).toBe('SIGNED_OUT');
    });

    it('an ended session is still RESOLVABLE by its token', async () => {
      // The session row remains so the sign-in/sign-out event stream can be
      // reconstructed. It authorises nothing, but it is not erased.
      await sessions.save(makeSession('token-value'));
      await sessions.end('session-1', LATER, 'SIGNED_OUT');

      const found = await sessions.findByToken(new SessionToken('token-value'));
      expect(found).not.toBeNull();
      expect(found!.isEnded()).toBe(true);
      expect(found!.endedCause).toBe('SIGNED_OUT');
    });

    it('does not end a session twice', async () => {
      await sessions.save(makeSession('token-value'));
      await sessions.end('session-1', LATER, 'SIGNED_OUT');
      await sessions.end('session-1', new Date('2026-10-30T10:00:00.000Z'), 'EXPIRED');

      const row = db
        .prepare('SELECT ended_at, ended_cause FROM identity_sessions WHERE id = ?')
        .get('session-1') as { ended_at: string; ended_cause: string };

      expect(row.ended_cause).toBe('SIGNED_OUT');
      expect(row.ended_at).toBe(LATER.toISOString());
    });

    it('finds the live sessions for one operator', async () => {
      await sessions.save(makeSession('token-a', { id: 'session-a' }));
      await sessions.save(
        makeSession('token-b', { id: 'session-b', expiresAt: new Date('2026-10-30T09:00:00.000Z') }),
      );
      await sessions.end('session-b', NOW, 'SIGNED_OUT');

      const live = await sessions.findLiveByOperator(
        OperatorId.create('OP-001'),
        NOW,
      );

      expect(live.map((s) => s.id)).toEqual(['session-a']);
    });

    it('finds expired but unended sessions for reaping', async () => {
      // A session that expires BEFORE "now" must have been authenticated
      // before it expired — the domain refuses to construct a session whose
      // expiry precedes its authentication.
      await sessions.save(
        makeSession('token-a', {
          id: 'session-a',
          authenticatedAt: new Date('2026-10-30T06:00:00.000Z'),
          expiresAt: new Date('2026-10-30T07:00:00.000Z'),
        }),
      );
      await sessions.save(makeSession('token-b', { id: 'session-b' }));

      const expired = await sessions.findExpired(NOW);

      expect(expired.map((s) => s.id)).toEqual(['session-a']);
    });

    it('does NOT report an ended session as expired', async () => {
      // An ended session was ended early; it did not expire. The two are
      // different facts and the reaper must not conflate them.
      await sessions.save(
        makeSession('token-a', {
          id: 'session-a',
          authenticatedAt: new Date('2026-10-30T06:00:00.000Z'),
          expiresAt: new Date('2026-10-30T07:00:00.000Z'),
        }),
      );
      await sessions.end(
        'session-a',
        new Date('2026-10-30T06:30:00.000Z'),
        'SIGNED_OUT',
      );

      const expired = await sessions.findExpired(NOW);

      expect(expired.map((s) => s.id)).toEqual([]);
    });

    it('rejects a duplicate token hash', async () => {
      await sessions.save(makeSession('token-value'));

      // The two sessions differ in id but carry the same token, so the
      // UNIQUE constraint on token_hash rejects the second.
      await expect(
        sessions.save(makeSession('token-value', { id: 'session-2' })),
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });
  });

  describe('the schema', () => {
    it('rejects an operator role outside the allowed set', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO operators (id, display_name, role, active, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('EVIL-1', 'E. Vil', 'ADMIN', 1, NOW.toISOString()),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects a non-boolean active flag', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO operators (id, display_name, role, active, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('EVIL-2', 'E. Vil', 'OPERATOR', 7, NOW.toISOString()),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects a session with an unknown authentication method', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );

      expect(() =>
        db
          .prepare(
            `INSERT INTO identity_sessions
               (id, operator_id, role, method, token_hash, authenticated_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'session-x',
            'OP-001',
            'OPERATOR',
            'MAGIC',
            'deadbeef',
            NOW.toISOString(),
            LATER.toISOString(),
          ),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects a session for an operator that does not exist', async () => {
      // The foreign key is enforced: a session cannot exist without its
      // operator, or the audit trail would have dangling references.
      expect(() =>
        db
          .prepare(
            `INSERT INTO identity_sessions
               (id, operator_id, role, method, token_hash, authenticated_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'session-y',
            'GHOST-999',
            'OPERATOR',
            'LOCAL',
            'deadbeef',
            NOW.toISOString(),
            LATER.toISOString(),
          ),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('the migrations', () => {
    it('records every migration as applied', () => {
      const rows = db
        .prepare('SELECT id FROM schema_migrations ORDER BY id')
        .all() as { id: string }[];

      expect(rows.map((r) => r.id)).toEqual([
        '001-create-operators',
        '002-create-credentials',
        '003-create-identity-sessions',
        '004-index-identity-sessions',
        '005-create-supervisor-authorisations',
        '006-create-authorisation-consumptions',
        '007-index-authorisations',
      ]);
    });

    it('is idempotent — reopening applies nothing twice', () => {
      // An in-memory database cannot demonstrate this: reopening one gives
      // a DIFFERENT, empty database. The property under test is that a
      // REAL database reopened across a process restart does not re-apply
      // its migrations, so this test uses a file.
      const dir = mkdtempSync(join(tmpdir(), 'weighingms-migrations-'));
      const path = join(dir, 'migrations.sqlite');

      try {
        const first = openDatabase(path);
        const firstRows = first
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        first.close();

        const second = openDatabase(path);
        try {
          const secondRows = second
            .prepare('SELECT id FROM schema_migrations ORDER BY id')
            .all() as { id: string }[];

          // The same migration set — no duplicates, no omissions.
          expect(secondRows.map((r) => r.id)).toEqual(
            firstRows.map((r) => r.id),
          );
          expect(new Set(secondRows.map((r) => r.id)).size).toBe(
            secondRows.length,
          );
        } finally {
          second.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('preserves DATA across a reopen — migrations do not reset the schema', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'weighingms-migrations-'));
      const path = join(dir, 'persistence.sqlite');

      try {
        const first = openDatabase(path);
        const operators = new SqliteOperatorRepository(first);
        await operators.save(
          new Operator(
            OperatorId.create('OP-001'),
            'R. Karim',
            OperatorRole.operator(),
            true,
            NOW,
          ),
        );
        first.close();

        const second = openDatabase(path);
        try {
          const reopened = new SqliteOperatorRepository(second);
          const found = await reopened.findById(OperatorId.create('OP-001'));
          expect(found).not.toBeNull();
          expect(found!.displayName).toBe('R. Karim');
        } finally {
          second.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
