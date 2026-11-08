/**
 * WeighingRecord — the record of a completed weighing.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 09:14:22, operator OP-001 weighed 94.2400 g of DYE-4471 into
 * container C-12 on SCALE-A, and the zone was OK"* is a fact about something
 * that physically happened. BRD DR-02 requires that it not be revised, and
 * C-12 says the same: *"a correction is a **new** record referencing the
 * original."*
 *
 * So this class exposes **no mutator**, and the table is append-only with
 * `BEFORE UPDATE` and `BEFORE DELETE` triggers that abort (ADR-034's rule,
 * applied to the record).
 *
 * AND IT IS A DIFFERENT THING FROM THE SESSION
 * ---------------------------------------------
 * The session is the **live state** of work in progress, and it is mutable
 * (ADR-036). The record is an **act**, and it is not. Two tables, two
 * reasons — and the distinction is the one DR-02 actually protects.
 *
 * WHY THE TARGET, THE TOLERANCE AND THE SCALE'S CLASS ARE SNAPSHOTTED
 * ------------------------------------------------------------------
 * Because a later revision must not rewrite history (BRD FR-25, BRD BR-14).
 * If the record held a *reference* to the recipe, then a revision in
 * OrgaTEX would change what the record says — and the record is the evidence
 * in a shade-failure investigation.
 *
 * So the values are copied at weighing time, and the record carries them
 * exactly as they were.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleClass } from '../../../004-scale-integration/domain/value-objects/scale-capability.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { ToleranceZone } from '../value-objects/tolerance-zone.js';

export class WeighingRecord {
  constructor(
    /** The record's identity. */
    readonly recordId: string,
    /** The session it belongs to. */
    readonly sessionId: string,
    /** The recipe slot it fulfils. */
    readonly componentId: ComponentId,
    /** What was weighed — **already net of the tare**. */
    readonly actualQuantity: WeightValue,
    /** The target **as it was at weighing time**. */
    readonly targetAtWeighing: WeightValue,
    /** The band **as it was at weighing time**. */
    readonly toleranceAtWeighing: Tolerance | null,
    /** The zone at the moment of confirmation. */
    readonly zoneAtConfirm: ToleranceZone,
    /** The device it was weighed on. */
    readonly scaleId: ScaleId,
    /** The device's class, **snapshotted** — a later reselection cannot alter it. */
    readonly scaleClass: ScaleClass,
    /** The lot, when one was captured. */
    readonly lotNumber: string | null,
    /** The container, when one was assigned. */
    readonly containerId: string | null,
    /** Who confirmed it. */
    readonly operatorId: OperatorId,
    /** When it was weighed. */
    readonly weighedAt: Instant,
    /**
     * The original, when this record is a **correction**.
     *
     * The original is **untouched** — a correction is a new row (C-12).
     */
    readonly correctsRecordId: string | null = null,
  ) {}
}
