/**
 * ScaleSelectionOutcome — the result of the automatic selection rule.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A DISCRIMINATED UNION, NOT A NULLABLE SCALE ID (ADR-018)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The rule has two outcomes: a device was selected, or NO DEVICE CAN
 * WEIGH THIS TARGET. The second is an explicit answer carrying the
 * target and the maximum available capacity — not a silent absence, and
 * not a guess.
 *
 * WHY THE UNION MATTERS MORE THAN THE STATUS CODE
 * -----------------------------------------------
 * In TypeScript, a caller holding an outcome must NARROW it before it can
 * read `scaleId` — and narrowing is the point at which the caller decides
 * what to do with the "no device" case. A caller therefore CANNOT
 * accidentally treat the no-device outcome as a successful selection,
 * because the successful branch's fields do not exist on the other
 * branch. The mistake becomes a compile error rather than a runtime
 * surprise.
 *
 * The API shape `{ selected: boolean, scaleId?: string }` would give the
 * caller a `scaleId` that is `undefined` on the failure branch, and
 * `undefined` flows straight into a URL, a database write or a UI
 * without being noticed.
 *
 * THE "NO DEVICE" CASE IS NOT AN ERROR
 * ------------------------------------
 * The question "which scale?" has been answered correctly. A 4xx would
 * make the caller treat a legitimate business outcome as a failure — it
 * would alert, show the operator an error, and retry a deterministic
 * answer.
 */
import type { ScaleSelection } from '../entities/scale-selection.js';
import type { WeightValue } from '../value-objects/weight-value.js';
import type { ScaleClass } from '../value-objects/scale-capability.js';

export type ScaleSelectionOutcome =
  | {
      readonly kind: 'SELECTED';
      readonly selection: ScaleSelection;
    }
  | {
      readonly kind: 'NO_DEVICE_CAN_WEIGH';
      /** The target that could not be weighed. */
      readonly target: WeightValue;
      /** The largest capacity available among the registered devices. */
      readonly maximumCapacity: WeightValue;
      /** The class that was demanded, for the caller's message. */
      readonly demandedClass: ScaleClass;
    };
