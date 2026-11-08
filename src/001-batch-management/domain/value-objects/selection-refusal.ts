/**
 * SelectionRefusal — why a choice was not made.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A REFUSAL NAMES A CAUSE. IT IS NEVER A SHAKE OF THE HEAD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story is explicit:
 *
 * > "the reason names the actual cause (not yet released, already weighed,
 * > on hold, or belonging to another station) and never a generic 'not
 * > available' message (FR-1, FR-2, BRD BR-03, BRD FR-03)."
 *
 * So the reason is a **code** from a closed set — NFR-11 and FR-22 require
 * the API to emit codes and the UI to own the text — and each code names a
 * **different situation**, because the operator's correct next action
 * differs for each one.
 *
 * WHY THERE ARE TWO AXES
 * ----------------------
 * "I do not know that code" and "I know that batch, and it is not
 * available" are **different facts**, and collapsing them would tell an
 * operator their batch is on hold when it was never in the queue at all.
 *
 *   UNRECOGNISED_CODE — the scan named nothing the MES knows.
 *   UNKNOWN_BATCH     — the touch named a batch that is not in the queue.
 *   (the four ineligibility reasons below) — the batch is known, and it may
 *   not be worked, and here is exactly why.
 *
 * WHY THE INELIGIBILITY REASONS ARE UNIT 005's
 * ---------------------------------------------
 * Unit 005 derives them from the MES's own status vocabulary; this unit
 * **enforces** the gate. Two copies of a rule would eventually disagree
 * (ADR-028), so this unit consumes unit 005's reasons rather than
 * re-deriving them.
 */
import type { IneligibilityReason } from '../../../005-orgatex-integration/domain/value-objects/batch-eligibility.js';

/**
 * The reasons this unit owns.
 *
 * `UNRECOGNISED_CODE` and `UNKNOWN_BATCH` are **recognition** failures —
 * the batch could not be identified at all. The four ineligibility reasons
 * are **eligibility** failures — the batch was identified and may not be
 * worked.
 */
export type SelectionRefusalReason =
  | 'UNRECOGNISED_CODE'
  | 'UNKNOWN_BATCH'
  | IneligibilityReason;

/**
 * Why the choice was refused.
 *
 * `reason` is the **code**. The message is the **diagnostic**, for the log
 * only — it never reaches the client (BRD IR-09), for the same reason the
 * MES's own error text never reaches the client.
 */
export interface SelectionRefusal {
  readonly reason: SelectionRefusalReason;
  /** For the LOG, never for the client (BRD IR-09). */
  readonly message: string;
}

/**
 * The refusal reasons, in one place.
 *
 * Exported so the presentation layer can validate a code it did not
 * construct, and so a test can assert the set is closed.
 */
export const SELECTION_REFUSAL_REASONS: readonly SelectionRefusalReason[] = [
  'UNRECOGNISED_CODE',
  'UNKNOWN_BATCH',
  'NOT_RELEASED',
  'BEING_WEIGHED_ELSEWHERE',
  'ALREADY_WEIGHED',
  'CANCELLED',
];

/**
 * Is this a refusal reason this product emits?
 */
export function isSelectionRefusalReason(
  value: unknown,
): value is SelectionRefusalReason {
  return (
    typeof value === 'string' &&
    (SELECTION_REFUSAL_REASONS as readonly string[]).includes(value)
  );
}

/**
 * The refusal reasons that come from unit 005's eligibility derivation.
 *
 * The distinction matters: only these four are **eligibility** refusals, and
 * only these four may be presented with a batch that was successfully
 * identified.
 */
export const INELIGIBILITY_REFUSAL_REASONS: readonly IneligibilityReason[] = [
  'NOT_RELEASED',
  'BEING_WEIGHED_ELSEWHERE',
  'ALREADY_WEIGHED',
  'CANCELLED',
];
