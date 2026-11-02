/**
 * BatchEligibilityRule — the derivation from a batch's status to its
 * eligibility.
 *
 * PURE. No clock, no adapter, no cache. A rule that needs any of those is
 * not a rule.
 *
 * THE MAPPING
 * -----------
 *   RELEASED  → ELIGIBLE
 *   QUEUED    → NOT_ELIGIBLE / NOT_RELEASED
 *   WEIGHING  → NOT_ELIGIBLE / BEING_WEIGHED_ELSEWHERE
 *   WEIGHED   → NOT_ELIGIBLE / ALREADY_WEIGHED
 *   CANCELLED → NOT_ELIGIBLE / CANCELLED
 *
 * WHY `WEIGHING` IS NOT ELIGIBLE
 * ------------------------------
 * A batch in `WEIGHING` was released at some point, and somebody is
 * working it now. BRD BR-03 permits weighing against a batch OrgaTEX has
 * released, and `WEIGHING` is the MES saying that this batch is in
 * progress elsewhere. Two stations weighing the same batch is a
 * quantities error — a real order gets two sets of consumption posted
 * against it.
 *
 * The prototype shows exactly this: `B-24187` is `WEIGHING` and is the
 * row marked as selected in the queue, while the other three are `QUEUED`.
 * The prototype's selection is a **display** choice; this rule is the
 * **business** answer, and they are allowed to differ.
 *
 * WHY `WEIGHED` IS ITS OWN CASE
 * -----------------------------
 * A weighed batch is not "not released" — it was released, and the work is
 * finished. Reporting it as `NOT_RELEASED` would tell an operator their
 * batch was never released, which is false and would send them looking for
 * the wrong problem.
 */
import type { BatchWeighingStatus } from '../value-objects/batch-weighing-status.js';
import type {
  BatchEligibility,
  IneligibilityReason,
} from '../value-objects/batch-eligibility.js';

export class BatchEligibilityRule {
  /**
   * Is this batch eligible for selection?
   *
   * @param status  The MES's own weighing status for the batch.
   */
  static evaluate(status: BatchWeighingStatus): BatchEligibility {
    switch (status) {
      case 'RELEASED':
        return { kind: 'ELIGIBLE' };
      case 'QUEUED':
        return { kind: 'NOT_ELIGIBLE', reason: 'NOT_RELEASED' };
      case 'WEIGHING':
        return {
          kind: 'NOT_ELIGIBLE',
          reason: 'BEING_WEIGHED_ELSEWHERE',
        };
      case 'WEIGHED':
        return { kind: 'NOT_ELIGIBLE', reason: 'ALREADY_WEIGHED' };
      case 'CANCELLED':
        return { kind: 'NOT_ELIGIBLE', reason: 'CANCELLED' };
    }
  }
}

/**
 * The reason codes, in one place.
 *
 * Exported so the presentation layer can validate a code it did not
 * construct, and so a test can assert the set is closed.
 */
export const INELIGIBILITY_REASONS: readonly IneligibilityReason[] = [
  'NOT_RELEASED',
  'BEING_WEIGHED_ELSEWHERE',
  'CANCELLED',
  'ALREADY_WEIGHED',
];
