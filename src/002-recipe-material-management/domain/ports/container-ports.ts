/**
 * The ports of bolt 012 — the container master, the tare command, and the
 * assignment's repository.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MASTER IS A PORT. THE TARE IS A PORT. NEITHER IS A CLIENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE MASTER
 * ----------
 * BRD §9.3 makes the container master **WeighingMS's own** data, so the
 * production binding is a **local table** — but the port is still a port,
 * because the domain must not know where the master lives. A test binds a
 * controlled master with a specific container.
 *
 * THE TARE
 * --------
 * The tare is applied to a **device**, and the device is unit `004`'s.
 * Unit `004`'s `ScaleRegistry.applyTare` already does the whole device-side
 * job — the reading that proves the device is there, the gate, the
 * conversion into the device's own unit, and the mechanism (ADR-012,
 * ADR-015, S-13).
 *
 * **So this unit does not re-implement any of it.** It declares a port over
 * the registry, and the composition root binds the two. And unit `004` is
 * **not** changed by this bolt at all — the port is the boundary.
 */
import type { Container } from '../entities/container.js';
import type { ContainerAssignment } from '../entities/container-assignment.js';
import type { ContainerId } from '../value-objects/container-id.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { TareSource } from '../../../004-scale-integration/domain/value-objects/tare-source.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { TareApplication } from '../../../004-scale-integration/domain/value-objects/tare-application.js';

/** The outcome of reading a container from the master. */
export type ContainerLookupOutcome =
  | {
      readonly kind: 'FOUND';
      readonly container: Container;
    }
  | {
      /** The master holds no such container. */
      readonly kind: 'NOT_FOUND';
    };

export interface ContainerMasterSource {
  /**
   * Read a container from the master.
   *
   * @returns The outcome. A miss is **returned**, not thrown — a container
   *          the master does not know is a state, not a failure.
   */
  read(containerId: ContainerId): Promise<ContainerLookupOutcome>;
}

/**
 * The tare command.
 *
 * The port is **narrow**: it applies a tare to a device and reports what
 * the device did. It does not select the device — that is unit `003`'s
 * progression — and it does not decide the tare's value — that is this
 * unit's policy.
 */
export interface ScaleTarePort {
  /**
   * Apply a tare to a device.
   *
   * @param scaleId The device.
   * @param tareValue The tare, in **the value's own unit** — the conversion
   *   into the device's unit happens inside the registry, so there is
   *   exactly one place a conversion happens.
   * @param source Where the value came from.
   * @returns What the device did. A refusal is **returned**, not thrown.
   */
  applyTare(
    scaleId: ScaleId,
    tareValue: WeightValue,
    source: TareSource,
  ): TareApplication;

  /**
   * The **empty container's** weight, as the device reads it.
   *
   * This is how a measured tare is obtained: the container is put on the
   * scale and read. It is the **device's** reading — never a client's
   * number, because a client-chosen tare would be a client-chosen
   * tolerance boundary (ADR-035).
   *
   * @returns The reading, or `null` when the device produced nothing. A
   *          device that has gone away is **absent**, never present with a
   *          reading of zero (S-1).
   */
  readEmptyContainer(scaleId: ScaleId): WeightValue | null;
}

/**
 * ContainerAssignmentRepository — the durable record of an assignment.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * An assignment is a fact about something that physically happened
 * (BRD DR-02), so there is no update path and no delete path here — and
 * the database's triggers are the second line of the same guarantee
 * (ADR-029, ADR-034, ADR-035).
 *
 * **The container is NOT de-duplicated.** The same container may be
 * assigned to two components, and both assignments are recorded — whether
 * one physical container may serve several components is **Q-10**, and the
 * station neither forbids nor assumes it.
 *
 * THE EFFECTIVE ASSIGNMENT IS THE NEWEST ROW
 * ------------------------------------------
 * `assigned_at DESC, id DESC` — a **total** order, so "the latest" has
 * exactly one answer, and a re-tare is a **new** assignment rather than an
 * update.
 */
export interface ContainerAssignmentRepository {
  /**
   * Record an assignment.
   *
   * INSERT ONLY. The row's identifier is the **insertion sequence**, and it
   * is what breaks a tie when two assignments land in the same millisecond.
   */
  save(assignment: ContainerAssignment): Promise<void>;

  /**
   * The newest assignment for a component — the effective one.
   *
   * `null` when no container has been assigned yet. An unassigned
   * component is a **state**, not an error.
   */
  latestFor(componentId: ComponentId): Promise<ContainerAssignment | null>;
}
