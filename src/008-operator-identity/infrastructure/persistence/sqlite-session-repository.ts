/**
 * SqliteSessionRepository.
 *
 * ADR-002: the session token is stored as a SHA-256 DIGEST, never in
 * plaintext. The raw token exists only in the sign-in response.
 *
 * NOTE THE MISSING `delete` — there is none, by design. A session is ENDED,
 * not deleted: an ended session is a record that something happened, and
 * the sign-out event depends on it. Reaping an ended row after its
 * retention window is a maintenance concern, not part of this contract.
 */
import { createHash } from 'node:crypto';
import type { SessionRepository } from '../../domain/ports/repositories.js';
import type {
  IdentitySession,
  SessionEndCause,
} from '../../domain/entities/identity-session.js';
import { IdentitySession as Session } from '../../domain/entities/identity-session.js';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { OperatorRole } from '../../domain/value-objects/operator-role.js';
import { SessionToken } from '../../domain/value-objects/session-token.js';
import { AuthenticationMethod } from '../../domain/value-objects/authentication-method.js';
import type { SqliteDatabase } from './database.js';

interface SessionRow {
  id: string;
  operator_id: string;
  role: string;
  method: string;
  token_hash: string;
  authenticated_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_cause: string | null;
}

/**
 * The digest of a session token.
 *
 * SHA-256 is deliberately FAST here. The token is 32 bytes from
 * `crypto.randomBytes` — 256 bits of entropy — so there is no search space
 * to brute-force. A slow KDF would add latency to every authenticated
 * request (including the 10 Hz weight path's authorisation check) to
 * defend against an attack that is already infeasible.
 */
export function hashSessionToken(token: SessionToken): string {
  return createHash('sha256').update(token.raw, 'utf8').digest('hex');
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Resolve a token to its session.
   *
   * Returns null for EVERY failure mode — unknown, tampered, truncated,
   * ended, expired. The difference between "no token" and "bad token" is
   * exactly what an attacker probes for, so it is not observable here.
   */
  async findByToken(token: SessionToken): Promise<IdentitySession | null> {
    const row = this.db
      .prepare('SELECT * FROM identity_sessions WHERE token_hash = ?')
      .get(hashSessionToken(token)) as unknown as SessionRow | undefined;
    return row ? this.toSession(row) : null;
  }

  async save(session: IdentitySession): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO identity_sessions
           (id, operator_id, role, method, token_hash, authenticated_at, expires_at, ended_at, ended_cause)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.operatorId.value,
        session.role.value,
        session.method.value,
        hashSessionToken(session.token),
        session.authenticatedAt.toISOString(),
        session.expiresAt.toISOString(),
        session.endedAt ? session.endedAt.toISOString() : null,
        session.endedCause ?? null,
      );
  }

  async end(
    sessionId: string,
    endedAt: Date,
    cause: SessionEndCause,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE identity_sessions
            SET ended_at = ?, ended_cause = ?
          WHERE id = ? AND ended_at IS NULL`,
      )
      .run(endedAt.toISOString(), cause, sessionId);
  }

  async findLiveByOperator(
    operatorId: OperatorId,
    now: Date,
  ): Promise<IdentitySession[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM identity_sessions
          WHERE operator_id = ? AND ended_at IS NULL AND expires_at > ?
          ORDER BY authenticated_at DESC`,
      )
      .all(operatorId.value, now.toISOString()) as unknown as SessionRow[];
    return rows.map((row) => this.toSession(row));
  }

  async findExpired(now: Date): Promise<IdentitySession[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM identity_sessions
          WHERE expires_at <= ? AND ended_at IS NULL
          ORDER BY expires_at`,
      )
      .all(now.toISOString()) as unknown as SessionRow[];
    return rows.map((row) => this.toSession(row));
  }

  private toSession(row: SessionRow): IdentitySession {
    return new Session(
      row.id,
      OperatorId.create(row.operator_id),
      OperatorRole.fromStored(row.role),
      AuthenticationMethod.fromStored(row.method),
      // The raw token is NOT recoverable from the row — by design. The
      // session object carries a placeholder so that in-memory consumers
      // have the same shape; the placeholder can never match a real token.
      new SessionToken(`stored:${row.id}`),
      new Date(row.authenticated_at),
      new Date(row.expires_at),
      row.ended_at ? new Date(row.ended_at) : null,
      row.ended_cause as SessionEndCause | null,
    );
  }
}
