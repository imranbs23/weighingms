/**
 * ScaleSelectionRule — the automatic scale-selection rule.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE ORDER OF THE STEPS
 * ----------------------
 *   1. convert the target into the unit the capacities are expressed in
 *   2. find the CANDIDATES — devices whose capacity is at least the target
 *   3. no candidates → NO_DEVICE_CAN_WEIGH (S-19)
 *   4. exactly one candidate → SELECTED
 *   5. several candidates → prefer the one whose class matches
 *   6. target is zero → the smallest-capability device that satisfies the
 *      class
 *
 * THE CAPACITY BOUNDARY IS INCLUSIVE
 * ----------------------------------
 * A target of exactly 3 kg is within the precision scale's 3 kg
 * capacity, and a target of exactly 32 kg is within the floor scale's
 * 32 kg capacity. The story pins this boundary explicitly, so it is
 * `>=` and not `>`.
 *
 * WHY THE CAPACITY CONSTRAINT WINS THE CONFLICT (ADR-017)
 * --------------------------------------------------------
 * When the demanded class matches none of the candidates, the two
 * constraints cannot both hold. The capacity constraint is a physical
 * impossibility — a 4 kg load cannot be weighed on a 3 kg scale — while
 * the class constraint is a measurement-quality preference. Honouring
 * the class would mean the 4 kg component could NEVER be weighed, which
 * is worse than weighing it on a coarser scale. The floor scale is
 * selected and the reason records the conflict, so the loss of precision
 * stays visible in the durable record.
 *
 * WHY THE RULE READS A SET OF DEVICES (ADR-019)
 * ----------------------------------------------
 * The rule is written against a SET of devices and a configuration —
 * never against two hard-coded scales. Two devices today; the rule does
 * not know or care. The capacities come from the registry, so a
 * recalibrated scale is reflected without a code change.
 *
 * THE THRESHOLD IS CONFIGURATION, AND IS CURRENTLY UNSET
 * -------------------------------------------------------
 * `Q-04` asks FCI production for the scale-selection threshold and the
 * boundary behaviour, and `A-06` binds the story until it is answered.
 * A threshold of 3 kg hard-coded in this rule would be an INVENTED
 * answer — one that merely coincides with the capacity today.
 *
 * So the threshold is a parameter that is currently `null`, and the rule
 * works fully without it: the capacity constraint alone decides every
 * case the story names. When FCI answers, the threshold is configured;
 * if it turns out to be a quantity other than the capacity, the rule is
 * already shaped to express it.
 */
import { Decimal } from 'decimal.js';
import { ScaleSelection } from '../entities/scale-selection.js';
import { ComponentId } from '../value-objects/component-id.js';
import { Instant } from '../value-objects/instant.js';
import { WeightValue } from '../value-objects/weight-value.js';
import type { ScaleSelectionOutcome } from '../value-objects/scale-selection-outcome.js';
import type { ScaleClass } from '../value-objects/scale-capability.js';
import type { SelectionReason } from '../entities/scale-selection.js';

/** The facts the rule needs about a device. */
export interface SelectableDevice {
  readonly scaleId: import('../value-objects/scale-id.js').ScaleId;
  readonly scaleClass: ScaleClass;
  readonly capacity: WeightValue;
}

export interface ScaleSelectionOptions {
  /**
   * The quantity at or below which a class-demanding component goes to
   * the precision scale.
   *
   * `null` until FCI answers `Q-04`. The rule works without it.
   */
  readonly threshold: WeightValue | null;
}

export class ScaleSelectionRule {
  constructor(private readonly options: ScaleSelectionOptions) {}

  /**
   * Select the device for a component.
   *
   * @param target        The quantity to be dispensed.
   * @param demandedClass The class of scale the component demands.
   * @param devices       The registered devices.
   * @param componentId   The component the selection is for.
   * @param now           The moment of the selection.
   */
  select(
    target: WeightValue,
    demandedClass: ScaleClass,
    devices: readonly SelectableDevice[],
    componentId: ComponentId,
    now: Instant,
  ): ScaleSelectionOutcome {
    if (devices.length === 0) {
      // No devices at all. There is no maximum capacity to report, so
      // this is the same explicit outcome with a zero maximum.
      return {
        kind: 'NO_DEVICE_CAN_WEIGH',
        target,
        maximumCapacity: WeightValue.of('0', target.unit),
        demandedClass,
      };
    }

    // 1. CONVERT. Every comparison below is between quantities in the
    //    SAME unit, because `WeightValue.compareTo` refuses to compare
    //    across units rather than converting behind the caller's back.
    const comparisonUnit = devices[0]?.capacity.unit ?? target.unit;
    const targetInDeviceUnit = convertTo(target, comparisonUnit);

    // 2. THE CANDIDATES. The boundary is INCLUSIVE.
    const candidates = devices.filter(
      (device) =>
        compare(convertTo(device.capacity, comparisonUnit), targetInDeviceUnit) >= 0,
    );

    // 3. NO CANDIDATE → the explicit outcome (S-19).
    if (candidates.length === 0) {
      const maximumCapacity = devices
        .map((device) => convertTo(device.capacity, comparisonUnit))
        .reduce((largest, capacity) =>
          compare(capacity, largest) > 0 ? capacity : largest,
        );
      return {
        kind: 'NO_DEVICE_CAN_WEIGH',
        target: targetInDeviceUnit,
        maximumCapacity,
        demandedClass,
      };
    }

    // 6. A TARGET OF ZERO is not "no device". The smallest-capability
    //    device that satisfies the class is selected. This is checked
    //    BEFORE the single-candidate case because a zero target makes
    //    EVERY device a candidate, and the reason must be TARGET_ZERO
    //    rather than an accident of how many devices there are.
    if (targetInDeviceUnit.isZero()) {
      const satisfying = candidates.filter(
        (device) => device.scaleClass === demandedClass,
      );
      const pool = satisfying.length > 0 ? satisfying : candidates;
      const smallest = smallestCapacity(pool);
      return this.buildSelection(smallest, componentId, demandedClass, now, 'TARGET_ZERO');
    }

    // 4. EXACTLY ONE CANDIDATE. It is selected whether or not its class
    //    matches — there is nothing else to choose.
    //
    //    And the reason records WHETHER THE CLASS WAS MET (ADR-017).
    //    This is not a corner case: with the two prototype scales, a
    //    4 kg component demanding precision has exactly one candidate —
    //    the floor scale — because the precision scale cannot hold it.
    //    So the conflict the story describes arises HERE, and a reason
    //    that said merely "capacity only" would lose the fact that the
    //    demanded precision was NOT available.
    if (candidates.length === 1) {
      const only = candidates[0] as SelectableDevice;
      const reason: SelectionReason =
        only.scaleClass === demandedClass
          ? 'CAPACITY_AND_CLASS'
          : 'CLASS_CONFLICT_RESOLVED_BY_CAPACITY';
      return this.buildSelection(only, componentId, demandedClass, now, reason);
    }

    // 5. SEVERAL CANDIDATES. Prefer the one whose class matches.
    const matching = candidates.filter(
      (device) => device.scaleClass === demandedClass,
    );

    if (matching.length > 0) {
      // The class is satisfiable. The smallest of the matching devices is
      // chosen — it is the closest match to the demanded capability, and
      // it leaves the larger device free.
      const smallest = smallestCapacity(matching);
      return this.buildSelection(
        smallest,
        componentId,
        demandedClass,
        now,
        'CAPACITY_AND_CLASS',
      );
    }

    // 5b. THE CLASS CANNOT BE SATISFIED. The capacity constraint wins
    //     (ADR-017). The smallest candidate is selected — it is the
    //     closest available match — and the reason RECORDS THE CONFLICT,
    //     so the loss of precision is visible rather than silent.
    const smallest = smallestCapacity(candidates);
    return this.buildSelection(
      smallest,
      componentId,
      demandedClass,
      now,
      'CLASS_CONFLICT_RESOLVED_BY_CAPACITY',
    );
  }

  /**
   * The threshold this rule was configured with.
   *
   * Exposed so a diagnostic can show whether FCI's answer has been
   * applied yet. `null` means it has not.
   */
  get threshold(): WeightValue | null {
    return this.options.threshold;
  }

  private buildSelection(
    device: SelectableDevice,
    componentId: ComponentId,
    demandedClass: ScaleClass,
    now: Instant,
    reason: SelectionReason,
  ): ScaleSelectionOutcome {
    return {
      kind: 'SELECTED',
      selection: new ScaleSelection(
        device.scaleId,
        componentId,
        now,
        reason,
        device.scaleClass,
        device.capacity,
      ),
    };
  }
}

/** The device with the smallest capacity. Ties break on the scale id. */
function smallestCapacity(devices: readonly SelectableDevice[]): SelectableDevice {
  return [...devices].sort((a, b) => {
    const byCapacity = compare(a.capacity, b.capacity);
    if (byCapacity !== 0) return byCapacity;
    return a.scaleId.value.localeCompare(b.scaleId.value);
  })[0] as SelectableDevice;
}

/**
 * Convert a weight into a unit, exactly.
 *
 * The rule's comparisons are all in the devices' unit, so this is the
 * one place the conversion happens. `decimal.js` does the arithmetic and
 * the result is a string fed back into `WeightValue` — no float ever
 * touches a quantity (BRD NFR-16).
 */
function convertTo(value: WeightValue, unit: string): WeightValue {
  if (value.unit === unit) return value;

  const gramsPerUnit: Record<string, string> = {
    g: '1',
    kg: '1000',
    mg: '0.001',
  };
  const from = gramsPerUnit[value.unit];
  const to = gramsPerUnit[unit];
  if (from === undefined || to === undefined) {
    throw new Error(`Cannot convert between "${value.unit}" and "${unit}"`);
  }

  const grams = new Decimal(value.text).times(from);
  const converted = grams.div(to);

  return WeightValue.of(stripTrailingZeros(converted.toFixed(6)), unit);
}

/** Compare two weights that are in the same unit. */
function compare(a: WeightValue, b: WeightValue): number {
  return a.compareTo(b);
}

/**
 * Remove the trailing zeros a fixed-point conversion introduces.
 *
 * `"40000.000000"` → `"40000"`, `"0.420000"` → `"0.42"`. The trailing DOT
 * goes with the zeros — a value with no integer part keeps its leading
 * zero and at least one decimal place.
 */
function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;

  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  if (trimmed === '' || trimmed === '-') return '0';

  if (trimmed.startsWith('.')) return `0${trimmed}`;
  if (trimmed.startsWith('-.')) return `-0${trimmed.slice(1)}`;

  return trimmed;
}
