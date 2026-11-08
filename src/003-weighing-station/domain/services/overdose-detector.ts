/**
 * OverdoseDetector — detects the over-dose and quantifies it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ZONE IS NOT RECOMPUTED HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The over-dose **is** the `OVER` zone, and the zone engine owns it (bolt
 * `014`). A second implementation of the `OVER` condition would be a second
 * answer to the same question — and the two would eventually disagree, which
 * is exactly how a reading becomes "over" in one place and "not over" in
 * another.
 *
 * So the detector **consumes the zone** and adds the two quantities the
 * story requires.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OVERSHOOT AND THE SURPLUS ARE DIFFERENT QUANTITIES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * | | Formula | What it is |
 * |---|---|---|
 * | **Overshoot** | `value − (target + tolerance)` | How far **past the tolerance maximum** the reading is |
 * | **Surplus** | `value − target` | The excess over the **target** — the status line's "SURPLUS +n" |
 *
 * The story's own worked numbers differ by exactly the tolerance —
 * `1.9000` and `2.4000` — and its first criterion calls the overshoot
 * "the surplus". So the implementation carries **both**, under their own
 * names, and the API reports both. The story's prose is ambiguous; its
 * numbers are not.
 *
 * AND THE PERCENTAGE IS UNDEFINED AT A ZERO TARGET
 * -----------------------------------------------
 * `surplus ÷ target × 100` has no answer when the target is zero — so the
 * percentage is **omitted** (`null`), never zero. A `0%` surplus on a
 * zero target would be a division that silently claimed an answer.
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import type { ToleranceZone } from '../value-objects/tolerance-zone.js';

/** How many decimal places the quantities carry. */
export const STORAGE_DECIMAL_PLACES = 4;

export type OverdoseOutcome =
  | {
      /** The zone is `OVER` — this is an over-dose. */
      readonly kind: 'OVERDOSE';
      /** How far past the tolerance maximum the reading is. */
      readonly overshoot: WeightValue;
      /** The excess over the target. */
      readonly surplus: WeightValue;
      /** The surplus as a percentage of the target — `null` at a zero target. */
      readonly surplusPercent: string | null;
    }
  | {
      /** The zone is not `OVER` — no surplus is produced. */
      readonly kind: 'NOT_OVER';
      readonly zone: ToleranceZone;
    };

export class OverdoseDetector {
  /**
   * Detect and quantify the over-dose.
   *
   * @param value The reading — net of the tare.
   * @param target The component's target.
   * @param band The MES's tolerance band — `null` means the MES expressed
   *   none, and then the band is zero.
   * @param zone The zone the engine computed.
   */
  detect(
    value: WeightValue,
    target: WeightValue,
    band: Tolerance | null,
    zone: ToleranceZone,
  ): OverdoseOutcome {
    // NOT OVER. No surplus is produced, and the over-dose response is not
    // offered.
    if (zone !== 'OVER') {
      return { kind: 'NOT_OVER', zone };
    }

    const unit = target.unit;

    // THE OVERSHOOT — past the tolerance maximum.
    const toleranceMaximum =
      band === null ? target : band.max;
    const overshoot = new Decimal(value.text)
      .minus(new Decimal(toleranceMaximum.text))
      .toDecimalPlaces(STORAGE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);

    // THE SURPLUS — over the target.
    const surplus = new Decimal(value.text)
      .minus(new Decimal(target.text))
      .toDecimalPlaces(STORAGE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);

    // THE PERCENTAGE — undefined at a zero target, and therefore omitted.
    const targetIsZero =
      new Decimal(target.text).isZero() || new Decimal(target.text).isNegative();
    const surplusPercent = targetIsZero
      ? null
      : new Decimal(surplus.toFixed(STORAGE_DECIMAL_PLACES))
          .dividedBy(new Decimal(target.text))
          .times(100)
          .toDecimalPlaces(STORAGE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP)
          .toFixed(STORAGE_DECIMAL_PLACES);

    return {
      kind: 'OVERDOSE',
      overshoot: WeightValue.of(overshoot.toFixed(STORAGE_DECIMAL_PLACES), unit),
      surplus: WeightValue.of(surplus.toFixed(STORAGE_DECIMAL_PLACES), unit),
      surplusPercent,
    };
  }
}
