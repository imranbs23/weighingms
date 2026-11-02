/**
 * ScaleSelection — WHICH DEVICE a component is weighed on.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A DECISION, NOT A CONNECTION SWITCH (S-16)
 * ══════════════════════════════════════════════════════════════════════
 *
 * Selecting the floor scale does NOT disconnect the precision scale.
 * Both devices may be connected concurrently (BRD IR-14), and selecting
 * one changes nothing about either device's status. So this aggregate
 * changes no device, and it is not an event about a device — it is a
 * record of a DECISION, which is why it carries the decision's own fields
 * rather than a device delta.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DEVICE'S FACTS ARE SNAPSHOTTED
 * ══════════════════════════════════════════════════════════════════════
 *
 * `scaleClass` and `capacity` are copied from the device at the moment
 * of selection. A later recalibration of the device must not be able to
 * alter a selection that has already been made — the same reasoning as
 * the weighing record's snapshot in unit `003`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NOT PERSISTED
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no `ScaleSelectionRepository`. A selection is a decision
 * CONSUMED by unit `003`, which snapshots it onto the weighing record —
 * and that is where a selection becomes durable. A selection table in
 * this unit would be a second source of truth for the same fact.
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ComponentId } from '../value-objects/component-id.js';
import type { Instant } from '../value-objects/instant.js';
import type { WeightValue } from '../value-objects/weight-value.js';
import type { ScaleClass } from '../value-objects/scale-capability.js';

/**
 * WHY THE SELECTION IS RECORDED (S-17, S-18)
 * -------------------------------------------
 * The story requires the selection to record the scale id, the component
 * id, the time of selection and the REASON. The reason is a closed set,
 * so a consumer can match on it without parsing prose.
 *
 * THE ONE QUESTION THE REASON ANSWERS
 * -----------------------------------
 * "Was the demanded scale class met?" — that is the question a consumer
 * needs answered, because the class is the component's requirement about
 * measurement quality, and the capacity is a physical impossibility that
 * no configuration can overrule.
 *
 *   CAPACITY_AND_CLASS                  the demanded class WAS met
 *   CLASS_CONFLICT_RESOLVED_BY_CAPACITY the demanded class could NOT be
 *                                       met; the capacity constraint won
 *                                       and the conflict is RECORDED
 *   TARGET_ZERO                         the target was zero, so the
 *                                       smallest device satisfying the
 *                                       class was chosen
 *
 * The second is the one that matters most. With the two prototype
 * scales, a 4 kg component demanding precision has only ONE candidate
 * — the floor scale — because the precision scale cannot hold it. So
 * the conflict arises in the single-candidate path, not only in the
 * multi-candidate one, and the reason must record it there too
 * (ADR-017). A reason that said merely "capacity only" would lose the
 * fact that the class was NOT met, and the loss of precision would be
 * invisible in the durable record.
 */
export type SelectionReason =
  | 'CAPACITY_AND_CLASS'
  | 'CLASS_CONFLICT_RESOLVED_BY_CAPACITY'
  | 'TARGET_ZERO';

export class ScaleSelection {
  constructor(
    readonly scaleId: ScaleId,
    readonly componentId: ComponentId,
    readonly selectedAt: Instant,
    readonly reason: SelectionReason,
    /** The DEVICE's class, snapshotted. */
    readonly scaleClass: ScaleClass,
    /** The DEVICE's capacity, snapshotted. */
    readonly capacity: WeightValue,
  ) {}
}
