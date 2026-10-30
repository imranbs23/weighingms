/**
 * RefusalReason — the closed set of ways a privileged action is refused.
 *
 * WHY THIS NAMES A REASON WHEN `AuthenticationFailure` DOES NOT
 * --------------------------------------------------------------
 * These look inconsistent, so the difference is stated deliberately.
 *
 * Bolt 001's `AuthenticationFailure` has a SINGLE reason, because the
 * threat there is ENUMERATION: an attacker probing sign-in to discover
 * which badge IDs exist. The defence is that "no such operator" and "wrong
 * password" are indistinguishable.
 *
 * Here the threat is the opposite in one respect and the same in another:
 *
 *   - the SYSTEM must record precisely which control was not satisfied,
 *     because the story requires the refused attempt to be audited "with
 *     the actor, the subject and the reason for refusal"; and
 *   - the CALLER must not be told, because a precise error is a map of
 *     the defences (ADR-004).
 *
 * So this reason lives INSIDE the domain and travels to the audit trail,
 * while the HTTP response carries a constant. The split is the decision.
 *
 * Every value here corresponds to one of the story's refusal cases, so a
 * new refusal path cannot be added without extending this union — and
 * extending it is a visible, reviewable change.
 */
export const REFUSAL_ROLE_NOT_SUPERVISOR = 'ROLE_NOT_SUPERVISOR';
export const REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED = 'SUPERVISOR_AUTHENTICATION_FAILED';
export const REFUSAL_SUPERVISOR_INACTIVE = 'SUPERVISOR_INACTIVE';
export const REFUSAL_REASON_MISSING = 'REASON_MISSING';
export const REFUSAL_REASON_NOT_MEANINGFUL = 'REASON_NOT_MEANINGFUL';
export const REFUSAL_SELF_AUTHORISATION = 'SELF_AUTHORISATION';
export const REFUSAL_NO_SIGNED_IN_OPERATOR = 'NO_SIGNED_IN_OPERATOR';
export const REFUSAL_NOT_THE_REQUESTING_OPERATOR = 'NOT_THE_REQUESTING_OPERATOR';
export const REFUSAL_OUT_OF_SCOPE = 'OUT_OF_SCOPE';
export const REFUSAL_EXPIRED = 'EXPIRED';
export const REFUSAL_ALREADY_USED = 'ALREADY_USED';
export const REFUSAL_UNKNOWN_AUTHORISATION = 'UNKNOWN_AUTHORISATION';

export const REFUSAL_REASONS = [
  REFUSAL_ROLE_NOT_SUPERVISOR,
  REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED,
  REFUSAL_SUPERVISOR_INACTIVE,
  REFUSAL_REASON_MISSING,
  REFUSAL_REASON_NOT_MEANINGFUL,
  REFUSAL_SELF_AUTHORISATION,
  REFUSAL_NO_SIGNED_IN_OPERATOR,
  REFUSAL_NOT_THE_REQUESTING_OPERATOR,
  REFUSAL_OUT_OF_SCOPE,
  REFUSAL_EXPIRED,
  REFUSAL_ALREADY_USED,
  REFUSAL_UNKNOWN_AUTHORISATION,
] as const;

export type RefusalReasonValue = (typeof REFUSAL_REASONS)[number];

export class RefusalReason {
  private constructor(readonly value: RefusalReasonValue) {}

  static of(value: RefusalReasonValue): RefusalReason {
    return new RefusalReason(value);
  }

  static fromStored(raw: string): RefusalReason {
    if ((REFUSAL_REASONS as readonly string[]).includes(raw)) {
      return new RefusalReason(raw as RefusalReasonValue);
    }
    throw new Error(`Unknown refusal reason: ${raw}`);
  }

  equals(other: RefusalReason): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
