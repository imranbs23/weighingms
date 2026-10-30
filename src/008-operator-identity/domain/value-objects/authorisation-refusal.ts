/**
 * AuthorisationRefusal — a named, audited refusal.
 *
 * A REFUSAL IS A LEGITIMATE OUTCOME, NOT AN ERROR. This context exists to
 * refuse privileged actions that are not properly authorised, so refusals
 * are its normal output. They are values, not exceptions.
 *
 * WHAT THIS CARRIES
 * -----------------
 * The reason, plus the actor (the signed-in operator), the action and the
 * subject that were requested. Those are the four things the story
 * requires a refusal to be audited with: "the actor, the subject and the
 * reason for refusal" (BRD FR-36, BRD NFR-13).
 *
 * THE ACTOR MAY BE NULL
 * ---------------------
 * A privileged action can be attempted with no signed-in operator at all —
 * the story's edge case says that is "Refused and audited as a refusal;
 * there is no operator for the authorisation to be distinct from". So the
 * actor is nullable, and the refusal still records what was attempted.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not reach the HTTP response. ADR-004: the caller receives one
 * status and one body for every refusal, because a precise error is a map
 * of the defences. This value travels to the AUDIT TRAIL.
 */
import { OperatorId } from './operator-id.js';
import { PrivilegedAction } from './privileged-action.js';
import { AuthorisationSubject } from './authorisation-subject.js';
import { RefusalReason } from './refusal-reason.js';

export class AuthorisationRefusal {
  private constructor(
    readonly reason: RefusalReason,
    readonly actor: OperatorId | null,
    readonly action: PrivilegedAction | null,
    readonly subject: AuthorisationSubject | null,
    readonly occurredAt: Date,
  ) {}

  static create(
    reason: RefusalReason,
    actor: OperatorId | null,
    action: PrivilegedAction | null,
    subject: AuthorisationSubject | null,
    occurredAt: Date,
  ): AuthorisationRefusal {
    return new AuthorisationRefusal(reason, actor, action, subject, occurredAt);
  }
}
