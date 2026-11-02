/**
 * DispenseRamp — the synthetic dispensing behaviour, as a pure function.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE PROTOTYPE'S OWN FORMULA
 * ---------------------------
 * The prototype runs this in the page's JavaScript:
 *
 *     var step = Math.max(k.target * 0.004, remaining * 0.055);
 *     now = Math.min(landing, now + step);
 *
 * with two landings:
 *
 *     in tolerance : k.target + k.tol * 0.4
 *     over tolerance: k.target + k.tol * 4.8
 *
 * The constants are READ FROM THE PROTOTYPE, not invented.
 *
 * WHY IT IS HERE AND NOT IN THE UI
 * --------------------------------
 * The unit brief moved it here deliberately. In the prototype it lives in
 * the page's JavaScript as a timer that increments a fake weight — which
 * would make the UI the SOURCE OF TRUTH for weight. That is exactly the
 * arrangement BRD C-02 and the "no hard-coded fixture data in the UI" rule
 * forbid. Moved here, the UI reads a stream like it would from a real
 * indicator.
 *
 * WHY `decimal.js` IS USED HERE
 * -----------------------------
 * This is one of the two places in the product where quantities are
 * actually COMPUTED. `decimal.js` does the arithmetic exactly, and its
 * output is a string — which is what `WeightValue` takes (ADR-008).
 *
 * THE STEP IS APPLIED PER SAMPLE, NOT PER PROTOTYPE TICK
 * ------------------------------------------------------
 * The prototype's timer runs every 34 ms. The adapter samples every
 * 100 ms (10 Hz, IR-10). Applying the step per prototype tick inside a
 * 100 ms sample would advance the ramp by roughly three steps per sample
 * and overshoot its own landing.
 *
 * So the step is computed PER SAMPLE from the CURRENT value, and the
 * landing is hit EXACTLY: the final sample is `min(current + step,
 * landing)`.
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../value-objects/weight-value.js';

/** The prototype's floor on the step: 0.4% of the target. */
export const RAMP_MIN_STEP_RATE = '0.004';

/** The prototype's decay rate: 5.5% of the remaining distance. */
export const RAMP_REMAINING_RATE = '0.055';

/** The prototype's in-tolerance landing: target + 40% of tolerance. */
export const RAMP_LANDING_IN_TOLERANCE_RATE = '0.4';

/** The prototype's over-tolerance landing: target + 480% of tolerance. */
export const RAMP_LANDING_OVER_TOLERANCE_RATE = '4.8';

export type RampLanding = 'IN_TOLERANCE' | 'OVER_TOLERANCE';

export class DispenseRamp {
  /**
   * The landing value for a given target and tolerance.
   *
   * EXACTLY the prototype's formula.
   */
  landing(
    target: WeightValue,
    tolerance: WeightValue,
    mode: RampLanding,
  ): WeightValue {
    const t = new Decimal(target.text);
    const tol = new Decimal(tolerance.text);
    const rate =
      mode === 'IN_TOLERANCE'
        ? new Decimal(RAMP_LANDING_IN_TOLERANCE_RATE)
        : new Decimal(RAMP_LANDING_OVER_TOLERANCE_RATE);

    return WeightValue.of(t.plus(tol.times(rate)).toFixed(4), target.unit);
  }

  /**
   * Advance the ramp one sample.
   *
   * @param current   The weight currently on the scale.
   * @param target    The target the ramp is dispensing toward.
   * @param tolerance The tolerance, used only to compute the landing.
   * @param mode      Which landing to aim for.
   * @returns The new weight, and whether the landing has been reached.
   *
   * The step is `max(target × 0.004, remaining × 0.055)` — the
   * prototype's formula exactly. The result is clamped to the landing, so
   * the ramp lands EXACTLY rather than approximately.
   */
  step(
    current: WeightValue,
    target: WeightValue,
    tolerance: WeightValue,
    mode: RampLanding,
  ): { readonly value: WeightValue; readonly landed: boolean } {
    const landing = this.landing(target, tolerance, mode);

    const cur = new Decimal(current.text);
    const tgt = new Decimal(target.text);
    const land = new Decimal(landing.text);

    const remaining = land.minus(cur);
    if (remaining.lessThanOrEqualTo(0)) {
      return { value: landing, landed: true };
    }

    const step = Decimal.max(
      tgt.times(new Decimal(RAMP_MIN_STEP_RATE)),
      remaining.times(new Decimal(RAMP_REMAINING_RATE)),
    );

    const next = Decimal.min(land, cur.plus(step));
    return {
      value: WeightValue.of(next.toFixed(4), current.unit),
      landed: next.equals(land),
    };
  }
}
