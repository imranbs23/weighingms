/**
 * The ports of bolt 013 — the scale-selection rule and the session's
 * repository.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RULE IS UNIT 004's. THE PORT IS OURS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `004` already owns the scale-selection rule, and it already
 * answers the question in the shape this unit needs:
 *
 *   - a **discriminated union** — `SELECTED` or `NO_DEVICE_CAN_WEIGH` —
 *     so a caller cannot mistake the no-device case for a successful
 *     selection (ADR-018);
 *   - the **threshold as configuration**, `null` until FCI answers `Q-04`
 *     (ADR-019).
 *
 * **So this unit declares a port and binds the registry.** It does not
 * re-implement the rule, and it does not hard-code a threshold.
 *
 * THE SESSION IS PERSISTED, AND IT IS MUTABLE
 * --------------------------------------------
 * The session is the station's own **live state** — the MES has no idea
 * where the operator got to, and it cannot be re-derived — so it is
 * persisted so the work can be resumed (NFR-06). And it is **mutable**,
 * because it is not a record of a completed act; the `WeighingRecord` is
 * that, and it is immutable (BRD DR-02, ADR-036).
 */
import type { WeighingSession } from '../entities/weighing-session.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ReadingSequence } from '../../../004-scale-integration/domain/value-objects/reading-sequence.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleSelectionOutcome } from '../../../004-scale-integration/domain/value-objects/scale-selection-outcome.js';
import type { ScaleClass } from '../../../004-scale-integration/domain/value-objects/scale-capability.js';
import type { WeighingVerdict } from '../../../004-scale-integration/domain/services/scale-health-policy.js';

/**
 * The automatic scale-selection rule.
 *
 * **The operator never chooses the scale** (BRD BR-05), so there is no
 * port through which a client could. The rule is the only way a scale is
 * bound.
 */
export interface ScaleSelectionPort {
  /**
   * Resolve the scale for a component's target.
   *
   * @param target        The quantity to be dispensed.
   * @param demandedClass The class the component demands of a scale.
   * @param componentId   The component the selection is for — the rule
   *   records the selection against it.
   * @returns The rule's answer. `NO_DEVICE_CAN_WEIGH` is a **successful**
   *          answer to a well-formed question, not an error (ADR-018).
   */
  select(
    target: WeightValue,
    demandedClass: ScaleClass,
    componentId: string,
  ): Promise<ScaleSelectionOutcome>;

  /**
   * Prepare a device for weighing, and say whether it may.
   *
   * The device is **proved present** first — the registry is asked for one
   * reading, which is ingested through the normal path and brings the link
   * up. That is the same order unit `004`'s tare flow uses, and for the
   * same reason: a gate consulted against a device that has never spoken
   * answers about a device nobody has heard from.
   *
   * @param scaleId The device the rule chose.
   * @returns The gate's verdict — expired calibration, disconnected, or
   *          allowed.
   */
  bindScale(scaleId: ScaleId): Promise<WeighingVerdict>;

  /**
   * May this device weigh **right now**?
   *
   * The reading path consults this on each reading, because a reading from
   * a device that has gone away is the signal that it HAS gone away.
   */
  canWeigh(scaleId: ScaleId): WeighingVerdict;

  /**
   * The device's class — the **device's** fact.
   *
   * The weighing record **snapshots** it, so a later reselection cannot
   * alter what the weighing was measured on (BRD FR-25, BRD BR-14).
   */
  deviceClass(scaleId: ScaleId): ScaleClass | null;
}

/**
 * ScaleStreamPort — the device's live readings.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SESSION SUBSCRIBES TO THE DEVICE. IT DOES NOT POLL IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The weight arrives by **push** — NFR-01 budgets 100 ms for transport,
 * and polling would spend that budget on request overhead *and* could not
 * distinguish a disconnected indicator from a stationary weight.
 *
 * So this port is a **subscription**, and the session is the subscriber. The
 * reading is offered to the session, which applies its own rules — the
 * sequence guard, the unit check, the wrong-scale check — and updates the
 * session's current weight.
 *
 * **And the disconnection comes through the same subscription.** A status
 * frame saying the device has gone away is what tells the session that
 * weighing must be blocked — so there is **one** detector of the
 * disconnection in the product (unit `004`'s watchdog), and the session
 * reads its verdict rather than running a second watchdog of its own.
 */
export interface ScaleStreamPort {
  /**
   * Subscribe to a device's readings.
   *
   * @param scaleId The device.
   * @param onReading A reading arrived — already net of the tare.
   * @param onStatus The device's link state changed.
   * @returns The unsubscribe function.
   */
  subscribe(
    scaleId: ScaleId,
    onReading: (reading: {
      readonly value: WeightValue;
      readonly stable: boolean;
      readonly sequence: ReadingSequence;
    }) => void,
    onStatus: (status: 'CONNECTED' | 'DISCONNECTED') => void,
  ): () => void;
}

/**
 * WeighingSessionRepository — the session's durable state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SESSION IS MUTABLE. THE WEIGHING RECORD IS NOT. TWO KINDS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The session is the **live state** of work in progress, and it is
 * updated in place. It is **not** a record of a completed act — the
 * `WeighingRecord` is that, it is immutable, and it is a different table
 * (bolt `017`).
 *
 * The distinction is the same one ADR-035 drew for the container: **the
 * live state is maintained; the record of a completed act is not.**
 *
 * AND THE LAST ACCEPTED SEQUENCE IS PERSISTED
 * -------------------------------------------
 * So the out-of-order guard **survives a restart**. A reading replayed
 * after a restart is still rejected — rather than being accepted because
 * the in-memory floor was lost with the process (ADR-036).
 */
export interface WeighingSessionRepository {
  /**
   * Save the session's current state.
   *
   * An **upsert**: the session row is updated in place, because the
   * session's value is *now*.
   */
  save(session: WeighingSession): Promise<void>;

  /**
   * The current session, or `null` when none has been started.
   *
   * **SYNCHRONOUS**, because SQLite is synchronous — there is no I/O to
   * await, and the zone is evaluated on every reading. And a `null` is a
   * **state**, not an error — it is the UI's first render.
   */
  current(): WeighingSession | null;
}
