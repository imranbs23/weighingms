/**
 * ToleranceZoneEvaluator — the pure computation.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO STATE. NO PERSISTENCE. NO CLOCK. NO EXTERNAL CONTRACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * That is exactly why it is a value object **inside this unit** rather than
 * a separate unit: extracting it would put a network hop between the scale
 * and the confirmation button, and NFR-01 budgets 200 ms for the whole
 * path (BRD FR-16, BRD FR-17, C-05).
 *
 * THE RULE, IN ORDER, WITH THE FIRST MATCH WINNING
 * ------------------------------------------------
 *
 * ```text
 * 1. OVER   if  value >  okUpper
 * 2. OK     if  value >= okLower
 * 3. NEAR   if  value >= nearThreshold
 * 4. UNDER  otherwise
 * ```
 *
 * **The order is the rule.** If `OK` were tested first, the `OVER` rule
 * would be unreachable — because a reading above the band is *also* above
 * the lower bound. And `OVER` is the only **exclusive** bound, because the
 * over-dose is the case that must escalate (BRD FR-13, FR-20).
 *
 * The inclusivity is exactly as the requirement writes it, and the
 * asymmetry is deliberate (ADR-037):
 *
 * | Reading | Zone |
 * |---|---|
 * | exactly `target + tolerance` | `OK` — `OVER` is a strict `>` |
 * | exactly `target − tolerance` | `OK` — inclusive |
 * | exactly `target × 0.9` | `NEAR` — inclusive |
 * | one ULP below `target × 0.9` | `UNDER` |
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ToleranceZone } from '../value-objects/tolerance-zone.js';
import type { ZoneBounds } from '../value-objects/zone-bounds.js';

export class ToleranceZoneEvaluator {
  /**
   * Where does this reading sit?
   *
   * @param value The reading — **already net of the tare**, because the tare
   *   is applied at the device and the reading carries it (ADR-014).
   * @param bounds The component's three bounds, computed once when the
   *   component was selected.
   */
  evaluate(value: WeightValue, bounds: ZoneBounds): ToleranceZone {
    // 1. OVER — a STRICT comparison. A reading exactly at the bound is OK.
    if (value.compareTo(bounds.okUpper) > 0) {
      return 'OVER';
    }

    // 2. OK — inclusive at the lower bound.
    if (value.compareTo(bounds.okLower) >= 0) {
      return 'OK';
    }

    // 3. NEAR — inclusive at its bound.
    if (value.compareTo(bounds.nearThreshold) >= 0) {
      return 'NEAR';
    }

    // 4. UNDER — the remainder.
    return 'UNDER';
  }
}
