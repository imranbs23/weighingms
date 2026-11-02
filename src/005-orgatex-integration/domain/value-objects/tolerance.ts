/**
 * Tolerance — the band around the target that the MES allows.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A BAND, NOT A DEVIATION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD §9.2 stores `tolerance_min` and `tolerance_max` on the component —
 * two columns, not one. So the MES's own shape is a band, and a symmetric
 * "± 0.5" is a *rendering* of a band, not its storage form.
 *
 * The distinction matters because a band carries information a deviation
 * would lose. The prototype's `TOLERANCE ±0.5 g (93.5 – 94.5)` is
 * symmetric, but the BRD's storage form allows an asymmetric band, and this
 * unit must not lose that possibility by storing a deviation.
 *
 * THE INVARIANT, AND WHAT IT IS NOT
 * ----------------------------------
 * `min ≤ max`. That is all.
 *
 * The target is **not** required to lie inside the band. An MES is entitled
 * to define a band that excludes its own target — that would be the MES's
 * inconsistency to own, and this unit reports the MES's facts rather than
 * correcting them (the same reasoning as the absence of an aggregate).
 */
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

export class Tolerance {
  private constructor(
    readonly min: WeightValue,
    readonly max: WeightValue,
  ) {}

  /**
   * Build a tolerance band.
   *
   * Both bounds must be in the SAME unit — a band of grams against a
   * kilogram is a unit error, and comparing them would throw at the
   * boundary rather than at construction. It is caught here, where the
   * mistake is still local.
   */
  static of(min: WeightValue, max: WeightValue): Tolerance {
    if (min.unit !== max.unit) {
      throw new Error(
        `Tolerance bounds must share a unit (${min.unit} vs ${max.unit})`,
      );
    }
    if (min.compareTo(max) > 0) {
      throw new Error('Tolerance minimum must not exceed the maximum');
    }
    return new Tolerance(min, max);
  }

  /** Is this value inside the band? The bounds are INCLUSIVE. */
  contains(value: WeightValue): boolean {
    if (value.unit !== this.min.unit) {
      throw new Error(
        `Cannot test a ${value.unit} value against a ${this.min.unit} tolerance`,
      );
    }
    return value.compareTo(this.min) >= 0 && value.compareTo(this.max) <= 0;
  }

  get unit(): string {
    return this.min.unit;
  }
}
