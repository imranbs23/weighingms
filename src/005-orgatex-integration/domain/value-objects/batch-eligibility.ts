/**
 * BatchEligibility — may this batch be selected, and if not, why?
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS UNIT REPORTS ELIGIBILITY. IT DOES NOT ENFORCE IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD BR-03 says the business must not permit weighing against a batch
 * OrgaTEX has not released, and the story says the caller "can refuse to
 * select it with a stated reason".
 *
 * The **refusal** belongs to unit `001-batch-management`, which owns the
 * selection state machine. This unit states the fact — the batch is
 * released, or it is not, and here is why — so the caller has something
 * specific to refuse with.
 *
 * The distinction is not bureaucratic. A unit that both reported and
 * enforced would be duplicated by unit `001`, and the two copies would
 * eventually disagree about which batches are selectable.
 *
 * WHY THERE IS NO PROSE HERE
 * --------------------------
 * BRD NFR-11 requires externalised text: the API emits **codes**, and the
 * UI owns the text. So `reason` is a code from a closed set, not a
 * sentence. A sentence here would put English in the API, and the UI would
 * have to parse it to decide what to show.
 */

/**
 * The reason a batch is not eligible — a code, not a sentence.
 *
 * The codes are deliberately finer-grained than the eligibility kinds:
 * `NOT_RELEASED` covers two genuinely different situations (never released,
 * and being weighed elsewhere), and an operator needs to know which.
 */
export type IneligibilityReason =
  | 'NOT_RELEASED'
  | 'BEING_WEIGHED_ELSEWHERE'
  | 'CANCELLED'
  | 'ALREADY_WEIGHED';

/**
 * The eligibility outcome, with the reason attached.
 *
 * `ELIGIBLE` has no reason: there is nothing to state. The other kind
 * names what is wrong, so the caller can refuse with a stated reason.
 */
export type BatchEligibility =
  | { readonly kind: 'ELIGIBLE' }
  | {
      readonly kind: 'NOT_ELIGIBLE';
      readonly reason: IneligibilityReason;
    };
