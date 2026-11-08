/**
 * ContainerAssignment — the container a component draws from, and the tare
 * applied to it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 08:20:11, operator OP-001 assigned container C-12 to component
 * DYE-4471-Y, with a tare of 214.0000 g measured from the empty container"*
 * is a fact about something that physically happened. BRD DR-02 requires
 * that it not be revised, and the story requires that a superseded
 * assignment be **retained** rather than deleted.
 *
 * So this class exposes **no mutator**, and the table is append-only. The
 * effective assignment is the **newest row** (ADR-035).
 *
 * WHY THE TARE IS COPIED, AND NOT READ FROM THE DEVICE
 * -----------------------------------------------------
 * The device's tare is its **current zero reference**, and unit `004` never
 * persists it (ADR-015) — a stale one read back after a restart is a
 * **wrong number**.
 *
 * So the assignment carries **its own copy**, taken at the moment of the
 * assignment. If it read the device instead, the weighing record would
 * carry *whatever the scale is zeroed to now* — which, after the operator
 * moves to the next component, is the **next** container's tare. A wrong
 * number that looks right (ADR-035).
 *
 * THE SOURCE IS DERIVED, NOT SUPPLIED
 * -----------------------------------
 * The source says where the **value** came from — the master (a claim) or
 * the empty container on the scale (a measurement). Only the station knows
 * that, so the client cannot claim it. And it is a closed set, because a
 * claim and a measurement are different facts and an audit has to be able
 * to tell them apart.
 *
 * AND THE UNIT IS CARRIED, NOT CONVERTED
 * --------------------------------------
 * A master tare in kilograms against a component in grams is recorded with
 * its own unit, and **no implicit conversion** happens here — cross-unit
 * arithmetic belongs to unit `003`'s fixed-point rules. The story is
 * explicit: *"the unit is shown with the value and no implicit conversion
 * is performed."*
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { TareSource } from '../../../004-scale-integration/domain/value-objects/tare-source.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { ContainerId } from '../value-objects/container-id.js';
import type { ContainerType } from '../value-objects/container-type.js';
import type { AssignmentMethod } from '../value-objects/assignment-method.js';

export class ContainerAssignment {
  constructor(
    /** The recipe slot the container was assigned to. */
    readonly componentId: ComponentId,
    /** The vessel. */
    readonly containerId: ContainerId,
    /** The vessel's type — copied, so the record survives a master change. */
    readonly containerType: ContainerType,
    /** The tare applied, with its own unit. */
    readonly tareWeight: WeightValue,
    /** Where the tare VALUE came from — derived, never supplied. */
    readonly tareSource: TareSource,
    /** How the container was identified — derived, never supplied. */
    readonly assignmentMethod: AssignmentMethod,
    /** Who assigned it — from the session. */
    readonly assignedBy: OperatorId,
    /** **When the assignment happened.** */
    readonly assignedAt: Instant,
    /** The device the tare was applied to, when it was applied to one. */
    readonly scaleId: ScaleId | null,
  ) {}
}
