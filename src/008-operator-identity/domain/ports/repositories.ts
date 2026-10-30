/**
 * Repository ports.
 *
 * These contracts are declared by the DOMAIN, and implemented by
 * infrastructure. That inversion is the point: the domain states what it
 * needs, and the infrastructure supplies it.
 *
 * Two properties of these interfaces are load-bearing:
 *
 * 1. `SessionRepository` has NO `delete`. A session is ENDED, not deleted —
 *    an ended session is a record that something happened, and the
 *    sign-out event depends on it. (Reaping an ended row after its
 *    retention window is a physical delete done by a maintenance job, not
 *    part of this contract.)
 *
 * 2. `CredentialRepository` exposes NO method that can return a plaintext
 *    secret. It returns `Credential` objects, which by construction hold
 *    only a SecretHash.
 */
import type { Operator } from '../entities/operator.js';
import type { Credential } from '../entities/credential.js';
import type { IdentitySession, SessionEndCause } from '../entities/identity-session.js';
import type { OperatorId } from '../value-objects/operator-id.js';
import type { OperatorRole } from '../value-objects/operator-role.js';
import type { SessionToken } from '../value-objects/session-token.js';

export interface OperatorRepository {
  findById(id: OperatorId): Promise<Operator | null>;
  save(operator: Operator): Promise<void>;
  findAll(): Promise<Operator[]>;
}

export interface CredentialRepository {
  findByOperatorAndRole(
    operatorId: OperatorId,
    role: OperatorRole,
  ): Promise<Credential | null>;
  findByOperator(operatorId: OperatorId): Promise<Credential[]>;
  save(credential: Credential): Promise<void>;
}

export interface SessionRepository {
  /**
   * Resolve a token to its session.
   *
   * Returns null for EVERY failure mode — unknown token, tampered token,
   * truncated token, ended token, expired token. The difference between
   * "no token" and "bad token" is exactly what an attacker probes for, so
   * it is not observable.
   */
  findByToken(token: SessionToken): Promise<IdentitySession | null>;

  save(session: IdentitySession): Promise<void>;

  end(
    sessionId: string,
    endedAt: Date,
    cause: SessionEndCause,
  ): Promise<void>;

  /** Live (not ended, not expired) sessions for one operator. */
  findLiveByOperator(operatorId: OperatorId, now: Date): Promise<IdentitySession[]>;

  /** Sessions whose expiry has passed — candidates for reaping. */
  findExpired(now: Date): Promise<IdentitySession[]>;
}
