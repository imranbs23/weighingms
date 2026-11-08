/**
 * EvaluateZone — the reading against the active component's bounds.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE COMPUTED ZONE, FED TO EVERY CONSUMER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The status line, the live-weight cell and the progress bar all render the
 * **same** zone — so they cannot disagree (FR-9, BRD FR-16, BRD FR-17).
 * And the zone is computed **in the domain**, and only in the domain: no
 * consumer, in particular no screen, derives it independently.
 *
 * **AND THE BOUNDS ARE COMPUTED ONCE, WHEN THE COMPONENT IS SELECTED.**
 * They are a fact about the **component**, not about the reading — so they
 * live with the component, and every reading is compared against the same
 * three numbers (ADR-037).
 *
 * **AND THE STILL-TO-WEIGH IS CLAMPED HERE, IN THE DOMAIN.**
 * `max(0, target − current)` — never negative, and never computed in a
 * renderer (FR-8, BRD FR-14).
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import type { Recipe } from '../../../002-recipe-material-management/domain/entities/recipe.js';
import type { RecipeWorkingCopy } from '../../../002-recipe-material-management/domain/services/recipe-working-copy.js';
import { ToleranceZoneEvaluator } from '../../domain/services/tolerance-zone-evaluator.js';
import { ZoneBounds } from '../../domain/value-objects/zone-bounds.js';
import type { ToleranceZone } from '../../domain/value-objects/tolerance-zone.js';

export type ZoneOutcome =
  | {
      readonly kind: 'ZONED';
      readonly zone: ToleranceZone;
      readonly value: WeightValue;
      readonly target: WeightValue;
      readonly tolerance: Tolerance | null;
      readonly bounds: ZoneBounds;
      /** `max(0, target − current)` — never negative. */
      readonly stillToWeigh: WeightValue;
    }
  | {
      /** There is no active component, or no reading yet. */
      readonly kind: 'NO_ZONE';
      readonly message: string;
    };

export interface EvaluateZoneOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** The current weight, net of the tare — the session's. */
  readonly currentWeight: () => WeightValue | null;
  /** The active component — the session's. */
  readonly activeComponentId: () => ComponentId | null;
  /** The evaluator. */
  readonly evaluator: ToleranceZoneEvaluator;
}

export class EvaluateZone {
  constructor(private readonly options: EvaluateZoneOptions) {}

  /** The current zone, and the still-to-weigh. */
  execute(): ZoneOutcome {
    const componentId = this.options.activeComponentId();
    if (componentId === null) {
      return { kind: 'NO_ZONE', message: 'No component is active' };
    }

    const value = this.options.currentWeight();
    if (value === null) {
      return { kind: 'NO_ZONE', message: 'There is no reading yet' };
    }

    const recipe = this.options.workingCopy.current();
    if (recipe === null) {
      return { kind: 'NO_ZONE', message: 'No recipe is loaded' };
    }

    const component = recipe.componentById(componentId.value);
    if (component === undefined || component === null) {
      return { kind: 'NO_ZONE', message: 'The active component is unknown' };
    }

    const target = component.target;
    const tolerance = component.tolerance === null ? null : component.tolerance;

    // THE BOUNDS ARE COMPUTED ONCE, from the component's own facts. The
    // near threshold is fixed-point — never a float (ADR-037).
    const bounds = ZoneBounds.of(target, tolerance);

    const zone = this.options.evaluator.evaluate(value, bounds);

    return {
      kind: 'ZONED',
      zone,
      value,
      target,
      tolerance,
      bounds,
      stillToWeigh: stillToWeigh(target, value),
    };
  }
}

/**
 * `max(0, target − current)`.
 *
 * **The clamp is applied HERE, in the domain** — not in the renderer. A
 * negative "still to weigh" would tell the operator to dispense a negative
 * quantity, and the fix belongs where the arithmetic is, not where it is
 * displayed.
 *
 * The subtraction is fixed-point (BRD NFR-16, C-11).
 */
export function stillToWeigh(
  target: WeightValue,
  current: WeightValue,
): WeightValue {
  // The units must match — a reading in the wrong unit is INVALID, not
  // convertible, and the session has already refused it.
  if (target.unit !== current.unit) {
    return WeightValue.of('0', target.unit);
  }

  const remaining = new Decimal(target.text).minus(new Decimal(current.text));
  if (remaining.isNegative() || remaining.isZero()) {
    // The zero is written at the STORAGE precision — `0.0000`, not `0` — so
    // the stored form is a function of the value and not of the path that
    // produced it.
    return WeightValue.of('0.0000', target.unit);
  }

  return WeightValue.of(remaining.toFixed(4), target.unit);
}

/**
 * The component's bounds — a helper for the confirmation gate, which needs
 * the same three numbers the zone was computed against.
 */
export function boundsFor(
  component: Recipe['components'][number],
): ZoneBounds {
  return ZoneBounds.of(component.target, component.tolerance);
}
