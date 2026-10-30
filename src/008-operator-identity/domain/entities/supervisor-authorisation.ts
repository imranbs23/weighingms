/**
 * SupervisorAuthorisation — a supervisor's scoped, expiring, reasoned
 * approval of ONE privileged action against ONE subject.
 *
 * ══════════════════════════════════════════════════════════════════════
 * INVARIANTS
 * ══════════════════════════════════════════════════════════════════════
 *
 * A-1  The supervisor is a DIFFERENT PERSON from the operator the action
 *      is for. Checked on OperatorId equality, NEVER on role — a person
 *      holding both roles still cannot self-authorise.
 *
 * A-2  The supervisor authenticated AT THE POINT OF THE ACTION. Enforced
 *      structurally: this aggregate is only ever created from a credential
 *      verification, and there is no method anywhere that builds one from
 *      a session id. "A supervisor is signed in elsewhere" is structurally
 *      irrelevant, not merely refused.
 *
 * A-3  The reason is present and meaningful. The `AuthorisationReason`
 *      value object cannot be constructed without one.
 *
 * A-4  Scoped to exactly one (action, subject) pair.
 *
 * A-5  Expires. At `expiresAt` exactly, it is invalid.
 *
 * A-6  Single-use. Enforced by the existence of an `AuthorisationConsumption`
 *      record — NOT by a field on this aggregate.
 *
 * A-7  APPEND-ONLY. Never updated, never deleted. Consumption is a
 *      separate aggregate precisely so that using an authorisation does not
 *      mutate it (ADR-006).
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THE SUPERVISOR IS NAMED BY ID, NOT BY ROLE
 * ══════════════════════════════════════════════════════════════════════
 * If this held a role, then two different supervisors would be
 * indistinguishable in the record, and A-1 could not be evaluated at all —
 * it would degenerate into "the authoriser had the supervisor role", which
 * is precisely the self-escalation the story forbids. Holding the id makes
 * the person checkable and the record attributable (BRD FR-24).
 */
import type { OperatorId } from '../value-objects/operator-id.js';
import type { SessionId } from '../value-objects/session-id.js';
import { PrivilegedAction } from '../value-objects/privileged-action.js';
import { AuthorisationSubject } from '../value-objects/authorisation-subject.js';
import { AuthorisationReason } from '../value-objects/authorisation-reason.js';
import { AuthorisationScope } from '../value-objects/authorisation-scope.js';
import { AuthorisationWindow } from '../value-objects/authorisation-window.js';

export class SupervisorAuthorisation {
  readonly scope: AuthorisationScope;

  constructor(
    readonly id: string,
    readonly sessionId: SessionId,
    readonly supervisorId: OperatorId,
    /**
     * The operator this authorisation was issued FOR.
     *
     * NULL when the privileged action was attempted with no signed-in
     * operator at all. The attempt is still audited as a refusal, but such
     * an authorisation can never be applied — there is no operator whose
     * session could match it.
     *
     * WHY THIS IS RECORDED
     * -------------------
     * ADR-003 requires a consume request to present the authorisation id
     * TOGETHER WITH the live session of "the operator the authorisation was
     * issued for". Without this field that requirement is unenforceable:
     * the authorisation could only be checked for being DISTINCT from the
     * supervisor, which would let ANY other operator apply an exception
     * raised for somebody else.
     */
    readonly requestedOperatorId: OperatorId | null,
    readonly action: PrivilegedAction,
    readonly subject: AuthorisationSubject,
    readonly reason: AuthorisationReason,
    readonly window: AuthorisationWindow,
  ) {
    this.scope = AuthorisationScope.of(action, subject);
  }

  get authorisedAt(): Date {
    return this.window.authorisedAt;
  }

  get expiresAt(): Date {
    return this.window.expiresAt;
  }

  /**
   * True when the authorisation is still live at `at`.
   *
   * INCLUSIVE BOUNDARY: at exactly `expiresAt` it is expired (A-5).
   */
  isLiveAt(at: Date): boolean {
    return this.window.isLiveAt(at);
  }

  /**
   * True when this authorisation applies to the requested action and
   * subject (A-4). BOTH must match.
   */
  isInScope(action: PrivilegedAction, subject: AuthorisationSubject): boolean {
    return this.scope.matches(action, subject);
  }

  /**
   * True when the supervisor is a DIFFERENT PERSON from the operator the
   * action is for (A-1).
   *
   * The check is on identity, never on role. A person who holds both roles
   * still cannot self-authorise.
   */
  isDistinctFrom(operatorId: OperatorId): boolean {
    return !this.supervisorId.equals(operatorId);
  }

  /**
   * True when this authorisation was issued FOR this operator.
   *
   * This is the check ADR-003 requires at the point of use. Distinctness
   * from the supervisor is NOT enough — an authorisation raised for
   * operator A must not be applied by operator B, even though B is also
   * not the supervisor.
   *
   * An authorisation issued with no operator at all matches nobody.
   */
  isIssuedFor(operatorId: OperatorId): boolean {
    return this.requestedOperatorId !== null && this.requestedOperatorId.equals(operatorId);
  }
}
