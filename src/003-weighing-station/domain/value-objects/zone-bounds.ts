/**
 * ZoneBounds — the three derived bounds, computed ONCE per component.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BOUNDS ARE A FACT ABOUT THE COMPONENT, NOT ABOUT THE READING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every reading is compared against **these three numbers** — never against
 * a fresh `target × 0.9` computed per reading. Two reasons:
 *
 * 1. **Determinism.** If every reading multiplied the target again, a
 *    rounding difference between two calls would make the **same reading**
 *    fall in different zones on different calls. The zone would flicker at
 *    the boundary, and the operator would see a weight that is sometimes
 *    `NEAR` and sometimes `UNDER` while the scale is perfectly still.
 *
 * 2. **One number, one comparison.** `× 0.9` happens in exactly one place.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE NEAR THRESHOLD IS FIXED-POINT, NEVER A FLOAT (ADR-037)
 * ══════════════════════════════════════════════════════════════════════
 *
 * In IEEE-754, `94.0000 × 0.9` is `84.60000000000001` — **not**
 * `84.6000`. And the boundary reading the requirement pins (`84.6000`,
 * which must be `NEAR`) falls on the **wrong side** of that.
 *
 * So the multiplication is `decimal.js`, **half-up**, at the storage
 * precision (4 decimal places):
 *
 * ```text
 * Decimal(94.0000) × Decimal(0.9) = 84.6000
 * ```
 *
 * exactly.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE `OK` BOUNDS ARE THE MES'S OWN BAND
 * ══════════════════════════════════════════════════════════════════════
 *
 * The requirement writes the rule as `target ± tolerance`, and the MES's
 * schema stores the band as **two bounds** — `tolerance_min` and
 * `tolerance_max` (BRD §9.2). So the band **is** the `OK` zone, and the
 * rule's `target ± tolerance` is the symmetric spelling of it.
 *
 * Using the band directly is therefore:
 *
 * - **exactly equivalent** when the band is symmetric about the target —
 *   which is the normal case, and the case every boundary test uses; and
 * - **more faithful** when it is not — because the MES's own statement of
 *   "inside tolerance" wins over a symmetry the MES did not assert.
 *
 * And with **no** band at all, the `OK` bounds are the target itself — so
 * `OK` requires the value to equal the target exactly, which is the
 * requirement's "tolerance is zero" case.
 *
 * AND THE INCLUSIVE AND EXCLUSIVE BOUNDS ARE AS WRITTEN
 * ---------------------------------------------------
 * - `okUpper` = the band's upper bound — and `OVER` is a **strict** `>`.
 *   A reading exactly at the bound is `OK`.
 * - `okLower` = the band's lower bound — and `OK` is **inclusive**.
 * - `nearThreshold` = `target × 0.9` — and `NEAR` is **inclusive**.
 *
 * The asymmetry is the requirement's answer to what reaches production, and
 * it is not an oversight (ADR-037).
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';

/** The multiplier for the near threshold — as a decimal string, not a float. */
export const NEAR_THRESHOLD_MULTIPLIER = '0.9';

/** How many decimal places the quantities carry. */
export const STORAGE_DECIMAL_PLACES = 4;

export class ZoneBounds {
  private constructor(
    /** `target × 0.9` — the `NEAR` bound, inclusive. */
    readonly nearThreshold: WeightValue,
    /** The band's lower bound — the `OK` bound, inclusive. */
    readonly okLower: WeightValue,
    /** The band's upper bound — the `OK` bound, `OVER` is strictly above it. */
    readonly okUpper: WeightValue,
  ) {}

  /**
   * Compute the bounds for a component.
   *
   * @param target The component's target.
   * @param band The MES's tolerance band — `null` means the MES expressed
   *   none, and then the `OK` bounds are the target itself.
   */
  static of(target: WeightValue, band: Tolerance | null): ZoneBounds {
    const unit = target.unit;

    const near = new Decimal(target.text)
      .times(new Decimal(NEAR_THRESHOLD_MULTIPLIER))
      .toDecimalPlaces(STORAGE_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);

    const lower =
      band === null ? target.text : band.min.text;
    const upper =
      band === null ? target.text : band.max.text;

    return new ZoneBounds(
      WeightValue.of(near.toFixed(STORAGE_DECIMAL_PLACES), unit),
      WeightValue.of(lower, unit),
      WeightValue.of(upper, unit),
    );
  }
}
