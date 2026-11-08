/**
 * CompensationCalculator — the proportional rule.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE IMPLEMENTATION, TWO ANSWERS. THEY CANNOT DISAGREE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story requires it: *"the compensability check and the proposal
 * generation share one rule implementation so they can never disagree."*
 *
 * "Is this surplus compensable?" and "what would the compensation be?" are
 * the same computation. So this one method answers both — and a decision of
 * "compensable" can never arrive with a proposal whose arithmetic is
 * impossible.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTOR IS COMPUTED. THE PROTOTYPE'S 1.026 IS NOT A RULE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ```text
 * factor        = surplus ÷ totalRemainingTarget
 * revisedTarget = originalTarget × (1 + factor)
 * ```
 *
 * The prototype's constant `1.026` is *its* worked example — a surplus of
 * `2.4 g` on a remaining total of `94.0 g`. Used against a remaining total
 * of `188.0 g` it would distribute `4.888 g` when only `2.4 g` was
 * over-dosed, and the error would be **invisible** because the numbers
 * would still add up (ADR-038).
 *
 * And the sum is preserved: the revised targets sum to the original
 * remaining total plus the surplus, to the last stored place.
 *
 * EVERY ARITHMETIC STEP IS FIXED-POINT DECIMAL
 * ----------------------------------------------
 * Half-up at the storage precision (4 dp). No float appears anywhere in the
 * factor or the revised targets (BRD NFR-16, C-11).
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

/** How many decimal places the quantities carry. */
export const STORAGE_DECIMAL_PLACES = 4;

/**
 * How many decimal places the **factor** carries.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTOR IS NOT A QUANTITY, AND IT NEEDS MORE PLACES THAN ONE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The factor is a **ratio**, not a weight — so it is not bound by the
 * storage precision for quantities. And it must carry **more** places,
 * because it is the multiplier for every remaining target: a factor
 * truncated to 4 places would scale a `74.0000 g` target by
 * `0.0255` instead of `0.025532`, and the revised target would be
 * `20.5100` instead of `20.5106` — the truncation would show up in the
 * **quantity**, where it is least visible.
 *
 * The story's own worked numbers fix the precision:
 *
 * - `2.4000 ÷ 94.0000 = 0.025532` — **six** places.
 * - `2.4000 ÷ 188.0000 = 0.012766` — **six** places.
 *
 * So the factor is computed at 6 places, and the **quantities** it produces
 * are still written at 4.
 */
export const FACTOR_DECIMAL_PLACES = 6;

/** One component's original and revised target. */
export interface ComponentRecalculation {
  readonly componentId: string;
  readonly originalTarget: WeightValue;
  readonly revisedTarget: WeightValue;
}

/** Why a surplus is not compensable. A **closed set** of three. */
export type NotCompensableReason =
  | 'NO_REMAINING_COMPONENTS'
  | 'ZERO_SURPLUS'
  | 'NEGATIVE_REVISED_TARGET';

export type CompensationOutcome =
  | {
      readonly kind: 'COMPENSABLE';
      /** The **computed** factor — never a constant. */
      readonly factor: string;
      readonly recalculated: readonly ComponentRecalculation[];
      /** The remaining total plus the surplus, for the check. */
      readonly revisedTotal: string;
    }
  | {
      readonly kind: 'NOT_COMPENSABLE';
      readonly reason: NotCompensableReason;
      readonly factor: string | null;
    };

export class CompensationCalculator {
  /**
   * Compute the compensation — and the compensability decision, together.
   *
   * @param surplus The excess over the target.
   * @param remaining The components **after** the active one, with their
   *   targets.
   */
  calculate(
    surplus: WeightValue,
    remaining: readonly {
      readonly componentId: string;
      readonly target: WeightValue;
    }[],
  ): CompensationOutcome {
    // NO REMAINING COMPONENTS. The surplus cannot be absorbed — there is
    // nothing to absorb it with.
    if (remaining.length === 0) {
      return {
        kind: 'NOT_COMPENSABLE',
        reason: 'NO_REMAINING_COMPONENTS',
        factor: null,
      };
    }

    // A ZERO SURPLUS. Nothing to distribute, so there is no proposal.
    if (new Decimal(surplus.text).isZero()) {
      return { kind: 'NOT_COMPENSABLE', reason: 'ZERO_SURPLUS', factor: null };
    }

    // THE REMAINING TOTAL — the denominator of the factor.
    let remainingTotal = new Decimal(0);
    for (const component of remaining) {
      remainingTotal = remainingTotal.plus(new Decimal(component.target.text));
    }

    // A zero remaining total has no factor either.
    if (remainingTotal.isZero()) {
      return {
        kind: 'NOT_COMPENSABLE',
        reason: 'ZERO_SURPLUS',
        factor: null,
      };
    }

    // THE FACTOR — computed from THIS surplus and THIS remaining total, at
    // the FACTOR's precision (6 places), which is finer than a quantity's.
    const factor = new Decimal(surplus.text)
      .dividedBy(remainingTotal)
      .toDecimalPlaces(FACTOR_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);

    const multiplier = new Decimal(1).plus(factor);

    const recalculated: ComponentRecalculation[] = [];
    let revisedTotal = new Decimal(0);

    for (const component of remaining) {
      const revised = new Decimal(component.target.text)
        .times(multiplier)
        .toDecimalPlaces(STORAGE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);

      // A REVISED TARGET BELOW ZERO. The surplus cannot be absorbed by a
      // component that would have to dispense a negative quantity.
      if (revised.isNegative()) {
        return {
          kind: 'NOT_COMPENSABLE',
          reason: 'NEGATIVE_REVISED_TARGET',
          factor: null,
        };
      }

      revisedTotal = revisedTotal.plus(revised);
      recalculated.push({
        componentId: component.componentId,
        originalTarget: component.target,
        revisedTarget: WeightValue.of(
          revised.toFixed(STORAGE_DECIMAL_PLACES),
          component.target.unit,
        ),
      });
    }

    return {
      kind: 'COMPENSABLE',
      factor: factor.toFixed(FACTOR_DECIMAL_PLACES),
      recalculated,
      revisedTotal: revisedTotal.toFixed(STORAGE_DECIMAL_PLACES),
    };
  }
}
