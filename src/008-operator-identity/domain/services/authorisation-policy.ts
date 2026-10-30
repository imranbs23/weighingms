/**
 * AuthorisationPolicy — the pure rules of the authorisation context.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE, NO ENVIRONMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every rule here is a pure function of its arguments. The current time is
 * an ARGUMENT, never read from an ambient clock — which is what makes the
 * expiry boundary testable EXACTLY rather than approximately, and what
 * makes this file exhaustible by a test suite with no fixtures.
 *
 * It returns `RefusalReason | null`, where null means PERMITTED.
 *
 * Returning the reason rather than a boolean is deliberate: the refusal
 * must be auditable with the reason it failed (A-8), and a boolean would
 * make the caller responsible for knowing which check failed.
 *
 * This is the SINGLE chokepoint for the rules. The unit brief requires that
 * "the checks live behind one interface in this unit, so they can be
 * exhausted exhaustively by tests rather than re-implemented at each call
 * site" — and re-derivation at a consumer is exactly what this design
 * forbids.
 */
import type { SupervisorAuthorisation } from '../entities/supervisor-authorisation.js';
import type { OperatorId } from '../value-objects/operator-id.js';
import type { OperatorRole } from '../value-objects/operator-role.js';
import type { PrivilegedAction } from '../value-objects/privileged-action.js';
import type { AuthorisationSubject } from '../value-objects/authorisation-subject.js';
import type { RefusalReason } from '../value-objects/refusal-reason.js';
import {
  REFUSAL_ALREADY_USED,
  REFUSAL_EXPIRED,
  REFUSAL_OUT_OF_SCOPE,
  REFUSAL_ROLE_NOT_SUPERVISOR,
  REFUSAL_SELF_AUTHORISATION,
  RefusalReason as RefusalReasonValue,
} from '../value-objects/refusal-reason.js';

export class AuthorisationPolicy {
  /**
   * May the supervisor authorise this action?
   *
   * Returns null when the action may proceed, or the reason it may not.
   *
   * THE ORDER OF THE CHECKS MATTERS, because the reason is audited. The
   * checks are ordered from "most fundamental" to "most specific", so the
   * recorded reason names the FIRST thing that was wrong. A supervisor who
   * is not a supervisor is reported as `ROLE_NOT_SUPERVISOR` rather than
   * `SELF_AUTHORISATION`, because the role check is the more fundamental
   * fact about them.
   *
   * NOTE: the role check compares the CREDENTIAL's role, not a role
   * supplied in a request (invariant I-4 from bolt 001).
   */
  mayAuthorise(
    supervisorRole: OperatorRole,
    supervisorId: OperatorId,
    requestingOperatorId: OperatorId | null,
  ): RefusalReason | null {
    // A different person. Checked on IDENTITY, never on role (A-1).
    //
    // This is checked FIRST because it is the most consequential fact: if
    // the authoriser is the operator, nothing else matters.
    if (requestingOperatorId !== null && supervisorId.equals(requestingOperatorId)) {
      return RefusalReasonValue.of(REFUSAL_SELF_AUTHORISATION);
    }

    // The authoriser must actually hold the supervisor role.
    if (!supervisorRole.isSupervisor()) {
      return RefusalReasonValue.of(REFUSAL_ROLE_NOT_SUPERVISOR);
    }

    return null;
  }

  /**
   * Is the authorisation live at `now`? (A-5)
   *
   * INCLUSIVE BOUNDARY: at exactly `expiresAt` it is expired.
   */
  isLive(authorisation: SupervisorAuthorisation, now: Date): boolean {
    return authorisation.isLiveAt(now);
  }

  /**
   * Is the authorisation in scope for this action and subject? (A-4)
   *
   * BOTH must match — an action that matches with a different subject is
   * out of scope, and so is a subject that matches with a different action.
   */
  isInScope(
    authorisation: SupervisorAuthorisation,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
  ): boolean {
    return authorisation.isInScope(action, subject);
  }

  /**
   * The reason an EXISTING authorisation may not be applied, or null if it
   * may.
   *
   * This is the check used at the point of USE. The order is: scope first
   * (a mismatched authorisation is refused for being the wrong one),
   * then expiry, then use.
   *
   * `isSpent` is supplied by the caller because spending is a fact about
   * storage, and the policy is pure.
   */
  evaluate(
    authorisation: SupervisorAuthorisation,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
    now: Date,
    isSpent: boolean,
  ): RefusalReason | null {
    if (!this.isInScope(authorisation, action, subject)) {
      return RefusalReasonValue.of(REFUSAL_OUT_OF_SCOPE);
    }
    if (!this.isLive(authorisation, now)) {
      return RefusalReasonValue.of(REFUSAL_EXPIRED);
    }
    if (isSpent) {
      return RefusalReasonValue.of(REFUSAL_ALREADY_USED);
    }
    return null;
  }
}
