/**
 * Identity domain events.
 *
 * These are PUBLISHED, not stored. This unit emits them; unit 006 owns the
 * audit trail that records them. The unit must not create an audit table —
 * that would give the audit trail two owners.
 *
 * Note what is absent: no event carries a secret, a token, or a stored
 * hash. The token is returned to the client exactly once, at sign-in, and is
 * never published.
 */
import type { OperatorId } from '../value-objects/operator-id.js';
import type { OperatorRole } from '../value-objects/operator-role.js';

export interface IdentityEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

export class OperatorSignedIn implements IdentityEvent {
  readonly type = 'OperatorSignedIn';
  constructor(
    readonly sessionId: string,
    readonly operatorId: OperatorId,
    readonly role: OperatorRole,
    readonly method: string,
    readonly authenticatedAt: Date,
    readonly expiresAt: Date,
    readonly occurredAt: Date,
  ) {}
}

export class OperatorSignedOut implements IdentityEvent {
  readonly type = 'OperatorSignedOut';
  constructor(
    readonly sessionId: string,
    readonly operatorId: OperatorId,
    readonly endedAt: Date,
    readonly cause: string,
    readonly occurredAt: Date,
  ) {}
}

export class SessionExpired implements IdentityEvent {
  readonly type = 'SessionExpired';
  constructor(
    readonly sessionId: string,
    readonly operatorId: OperatorId,
    readonly expiredAt: Date,
    readonly occurredAt: Date,
  ) {}
}

export class CredentialRotated implements IdentityEvent {
  readonly type = 'CredentialRotated';
  constructor(
    readonly operatorId: OperatorId,
    readonly role: OperatorRole,
    readonly rotatedAt: Date,
    readonly occurredAt: Date,
  ) {}
}

export class OperatorDeactivated implements IdentityEvent {
  readonly type = 'OperatorDeactivated';
  constructor(
    readonly operatorId: OperatorId,
    readonly deactivatedAt: Date,
    readonly occurredAt: Date,
  ) {}
}

/**
 * SignInRefused — the security-critical event.
 *
 * It records the operator id AS PRESENTED BY THE CLIENT, not as resolved.
 * Its `reason` field has a SINGLE value.
 *
 * If this event carried a reason distinguishing "unknown identity" from
 * "wrong password", the event stream itself would become the identity
 * oracle that the response body is careful not to be.
 */
export class SignInRefused implements IdentityEvent {
  readonly type = 'SignInRefused';
  readonly reason = 'INVALID_CREDENTIAL';
  constructor(
    readonly presentedOperatorId: string,
    readonly occurredAt: Date,
  ) {}
}
