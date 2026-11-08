/**
 * ScaleTareAdapter — the tare command, bound to unit 004's registry.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SHIM, AND THE THINNESS IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `004`'s `ScaleRegistry` already does the whole device-side job:
 *
 *   - it asks the adapter for a **reading**, which both proves the device
 *     is there and brings the link up;
 *   - it consults the **same gate** the weighing uses, so a tare is
 *     refused for exactly the reasons a weighing is refused (S-13);
 *   - it **converts** into the device's own unit, in the domain, so there
 *     is exactly one place a conversion happens;
 *   - it applies the tare through the device adapter, which decides the
 *     **mechanism** (at the indicator or in software) and reports the
 *     state it applied (ADR-012, ADR-015).
 *
 * **So this unit re-implements none of it.** This adapter is a shim over
 * the registry, and unit `004` is **not** changed by bolt 012 — the port
 * is the boundary (ADR-035).
 *
 * THE EMPTY CONTAINER'S READING
 * -----------------------------
 * The measured tare is the **device's** reading, never a client's number.
 * So it comes from the registry's own synchronous read — the same method
 * the tare flow uses to prove the device is there.
 */
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { TareSource } from '../../../004-scale-integration/domain/value-objects/tare-source.js';
import type { TareApplication } from '../../../004-scale-integration/domain/value-objects/tare-application.js';
import type { ScaleRegistry } from '../../../004-scale-integration/domain/services/scale-registry.js';
import type { ScaleAdapter } from '../../../004-scale-integration/domain/ports/scale-adapter.js';
import type { ScaleTarePort } from '../../domain/ports/container-ports.js';

export class ScaleTareAdapter implements ScaleTarePort {
  constructor(
    private readonly registry: ScaleRegistry,
    /**
     * The device adapters, by device id.
     *
     * The empty container's weight is read **from the device**, through the
     * same adapter the tare flow itself uses — so the measurement is the
     * device's own, and a device that has gone away produces **nothing**
     * rather than a reading of zero (S-1).
     *
     * It is the **same** adapter the registry reads through, so there is one
     * contact path per device and one place a tare reaches a device
     * (ADR-014).
     */
    private readonly adapters: Map<string, ScaleAdapter>,
  ) {}

  /**
   * Apply a tare to a device.
   *
   * The registry does everything — the gate, the conversion and the
   * mechanism — and reports what the device did.
   */
  applyTare(
    scaleId: ScaleId,
    tareValue: WeightValue,
    source: TareSource,
  ): TareApplication {
    return this.registry.applyTare(scaleId, tareValue, source);
  }

  /**
   * The empty container's weight, as the device reads it.
   *
   * `null` when the device produced nothing. A device that has gone away
   * is **absent**, never present with a reading of zero (S-1).
   */
  readEmptyContainer(scaleId: ScaleId): WeightValue | null {
    const adapter = this.adapters.get(scaleId.value);
    if (adapter === undefined) return null;

    const reading = adapter.readOnce(scaleId);
    if (reading === null) return null;

    // The reading is the device's GROSS weight — the tare in force is
    // subtracted by the device itself, and the empty container's weight is
    // what the device reports with no tare in force.
    return reading.value;
  }
}
