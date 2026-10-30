/**
 * Authorisation domain events.
 *
 * PUBLISHED, not stored — the same discipline as `identity-events.ts`. Unit
 * 006 owns the audit trail that records them; this unit must not create an
 * audit table, because that would give the trail two owners.
 *
 * Note what is absent: no event carries a secret, a token, a token digest,
 * or a stored hash.
 */
import type { OperatorId } from '../value-objects/operator-id.js';
import type { PrivilegedAction } from '../value-objects/privileged-action.js';
import type { AuthorisationSubject } from '../value-objects/authorisation-subject.js';
import type { AuthorisationReason } from '../value-objects/authorisation-reason.js';
import type { RefusalReason } from '../value-objects/refusal-reason.js';

/**
 * PrivilegeAuthorised — a supervisor's fresh authentication succeeded and
 * the authorisation was granted.
 *
 * Carries exactly what the audit trail and the confirmed weighing record
 * need: the authorising supervisor, the reason, the scope and the times.
 */
export class PrivilegeAuthorised {
  readonly type = 'PrivilegeAuthorised';
  constructor(
    readonly authorisationId: string,
    readonly supervisorId: OperatorId,
    /**
     * The operator the exception was raised FOR — null when there was no
     * signed-in operator. The audit trail needs it to attribute the
     * exception to the person who was given it.
     */
    readonly requestedOperatorId: OperatorId | null,
    readonly sessionId: string,
    readonly action: PrivilegedAction,
    readonly subject: AuthorisationSubject,
    readonly reason: AuthorisationReason,
    readonly authorisedAt: Date,
    readonly expiresAt: Date,
    readonly occurredAt: Date,
  ) {}
}

/**
 * PrivilegeRefused — a privileged action was refused for ANY reason.
 *
 * THIS EVENT CLOSES INVARIANT A-8: every refusal is audited with the
 * actor, the subject and the reason. It is emitted on every refusal path —
 * wrong role, no fresh authentication, missing reason, self-authorisation,
 * wrong scope, expired, already used, and no signed-in operator at all.
 *
 * WHY IT CARRIES A REASON WHILE THE HTTP RESPONSE DOES NOT
 * -------------------------------------------------------
 * This event is INTERNAL — it is consumed by the audit trail, which is
 * entitled to know which control was not satisfied. The HTTP response is
 * NOT internal: its caller is an operator attempting escalation, and a
 * precise error would be a map of the defences (ADR-004).
 *
 * The `reason` here is a fixed enum code, never prose.
 *
 * `actor` is the SIGNED-IN OPERATOR, or null when there is no signed-in
 * operator at all — the story's edge case says that attempt is "Refused
 * and audited as a refusal; there is no operator for the authorisation to
 * be distinct from".
 *
 * `requestedBy` is the identity whose CREDENTIAL was presented for
 * authorisation (the supervisor being authenticated), when one was
 * presented at all.
 */
export class PrivilegeRefused {
  readonly type = 'PrivilegeRefused';
  constructor(
    readonly reason: RefusalReason,
    readonly actor: OperatorId | null,
    readonly requestedBy: OperatorId | null,
    readonly action: PrivilegedAction | null,
    readonly subject: AuthorisationSubject | null,
    readonly occurredAt: Date,
  ) {}
}

/**
 * AuthorisationConsumed — a live, in-scope, unconsumed authorisation was
 * applied to a privileged action.
 */
export class AuthorisationConsumed {
  readonly type = 'AuthorisationConsumed';
  constructor(
    readonly authorisationId: string,
    readonly action: PrivilegedAction,
    readonly subject: AuthorisationSubject,
    readonly consumedAt: Date,
    readonly operatorId: OperatorId,
    readonly occurredAt: Date,
  ) {}
}

/**
 * AuthorisationExpired — an authorisation's expiry passed.
 *
 * Note that expiry MARKS the authorisation; it never deletes it. An expired
 * authorisation that was deleted would destroy the evidence that the
 * exception had been released.
 */
export class AuthorisationExpired {
  readonly type = 'AuthorisationExpired';
  constructor(
    readonly authorisationId: string,
    readonly expiredAt: Date,
    readonly occurredAt: Date,
  ) {}
}

/** Every event this context publishes. */
export type AuthorisationEvent =
  | PrivilegeAuthorised
  | PrivilegeRefused
  | AuthorisationConsumed
  | AuthorisationExpired;
