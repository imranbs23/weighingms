/**
 * IdentitySession — a period during which one operator is signed in.
 *
 * The session is its own aggregate (not a child of Operator) because it has
 * a life of its own, it ends independently of any operator change, and it
 * must be loadable BY TOKEN without loading the operator or the credential.
 * Making it a child of Operator would force every session lookup to load
 * the operator — putting the operator in the path of an authorisation check.
 *
 * INVARIANT I-2: the token is opaque. See `SessionToken`.
 */
import { OperatorId } from '../value-objects/operator-id.js';
import { OperatorRole } from '../value-objects/operator-role.js';
import { SessionToken } from '../value-objects/session-token.js';
import { AuthenticationMethod } from '../value-objects/authentication-method.js';

export const SESSION_END_CAUSE_SIGNED_OUT = 'SIGNED_OUT';
export const SESSION_END_CAUSE_REPLACED = 'REPLACED';
export const SESSION_END_CAUSE_EXPIRED = 'EXPIRED';

export type SessionEndCause =
  | typeof SESSION_END_CAUSE_SIGNED_OUT
  | typeof SESSION_END_CAUSE_REPLACED
  | typeof SESSION_END_CAUSE_EXPIRED;

export class IdentitySession {
  constructor(
    readonly id: string,
    readonly operatorId: OperatorId,
    readonly role: OperatorRole,
    readonly method: AuthenticationMethod,
    readonly token: SessionToken,
    readonly authenticatedAt: Date,
    readonly expiresAt: Date,
    readonly endedAt: Date | null = null,
    readonly endedCause: SessionEndCause | null = null,
  ) {
    if (authenticatedAt.getTime() >= expiresAt.getTime()) {
      throw new Error('Session must expire after it was authenticated');
    }
  }

  /** A session that has been explicitly ended authorises nothing. */
  isEnded(): boolean {
    return this.endedAt !== null;
  }

  /**
   * The session's end, as a new instance.
   *
   * The session is NEVER mutated and NEVER deleted — it is ended. The row
   * remains, carrying `ended_at` and `ended_cause`, so the sign-in/sign-out
   * event stream can be reconstructed. A deleted session would leave no
   * trace that it ever existed.
   */
  end(at: Date, cause: SessionEndCause): IdentitySession {
    return new IdentitySession(
      this.id,
      this.operatorId,
      this.role,
      this.method,
      this.token,
      this.authenticatedAt,
      this.expiresAt,
      at,
      cause,
    );
  }

  /** The role carried by this session — copied from the matched credential. */
  isSupervisor(): boolean {
    return this.role.isSupervisor();
  }
}
