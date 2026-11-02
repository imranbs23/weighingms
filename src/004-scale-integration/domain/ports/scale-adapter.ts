/**
 * ScaleAdapter — the SEAM (BRD IR-07).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE Q-03 SEAM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The indicator's make, model and protocol are UNCONFIRMED (Q-03), so no
 * wire protocol may be asserted as fact anywhere above this port. This
 * interface is the whole contract: "a live weight with a stability flag".
 *
 * If FCI's answer to Q-03 is that the indicators report only a SETTLED
 * value rather than a continuous stream, then a real adapter emits one
 * reading per settle event instead of ten per second, and `stable` becomes
 * the only meaningful signal. That is a genuine change to the product's
 * behaviour — and it is visible in EXACTLY ONE PLACE: the adapter.
 *
 * That is the entire point of building the seam this way. B-5 states the
 * consequence plainly: "if the scales return only a stabilised value
 * rather than a continuous stream, guided weighing as drawn is not
 * buildable". The assumption is therefore TESTABLE rather than merely
 * stated.
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ScaleReading } from '../value-objects/scale-reading.js';
import type { ScaleStatus } from '../value-objects/scale-status.js';
import type { CalibrationState } from '../value-objects/calibration-state.js';
import type { WeightValue } from '../value-objects/weight-value.js';
import type { Instant } from '../value-objects/instant.js';
import type { TareSource } from '../value-objects/tare-source.js';
import type { TareState } from '../entities/tare-state.js';

/**
 * What the domain asks a device to apply.
 *
 * The value MUST already be in the DEVICE's own unit — the conversion
 * happens in the domain, before the call, so that there is exactly one
 * place a conversion happens.
 *
 * The MECHANISM is deliberately absent: whether the tare ends up at the
 * indicator or in the software is the adapter's to determine, and it
 * reports it by returning the `TareState` it applied.
 */
export interface TareRequest {
  readonly value: WeightValue;
  readonly appliedAt: Instant;
  readonly source: TareSource;
}

export interface ScaleAdapter {
  /**
   * The live weight stream for one device.
   *
   * LIVE-ONLY. No backlog is replayed — a consumer that attaches late
   * sees readings from its attachment point onward. Replaying history
   * would present stale readings as current, which is the exact confusion
   * S-1 exists to prevent. A consumer that needs history uses the
   * weighing record, not the stream.
   */
  openStream(scaleId: ScaleId): AsyncIterable<ScaleReading>;

  /** The device's self-reported status. */
  readStatus(scaleId: ScaleId): ScaleStatus;

  /** The device's calibration state. */
  readCalibration(scaleId: ScaleId): CalibrationState;

  /**
   * Produce ONE reading from the device, synchronously.
   *
   * This is the synchronous counterpart of the stream, and it exists for
   * the TARE operation. A tare is a command sent TO a device, and a
   * device that has never spoken cannot be commanded — so the tare flow
   * asks the device for a reading, which both proves the device is
   * there and brings the link UP through the normal path.
   *
   * It returns `null` when the device produces nothing — the same
   * distinction the stream makes (S-1): a device that has gone away is
   * ABSENT, never present with a reading of zero.
   *
   * It is deliberately NOT the stream: the tare must not have to wait
   * for a sample interval, and it must not consume a reading that a
   * consumer is waiting for.
   */
  readOnce(scaleId: ScaleId): ScaleReading | null;

  /**
   * Apply a tare to the device.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE ONE PLACE A TARE REACHES A DEVICE (ADR-014)
   * ══════════════════════════════════════════════════════════════════
   *
   * Where the indicator supports a tare command, the command is issued
   * to the device. Where it does not, the tare is subtracted in software
   * from each reading as it is produced. Both paths produce the same
   * `TareState` shape, so nothing above the adapter learns which was
   * used — except through `TareMechanism`, which the story requires
   * (BRD IR-12).
   *
   * The readings this adapter produces from now on are NET — the gross
   * reading minus the tare — and carry the tare that produced them.
   *
   * It returns the `TareState` it actually applied, so that the state
   * on the device aggregate and the state the adapter is subtracting are
   * the SAME object rather than two independently constructed copies
   * that could disagree.
   */
  applyTare(scaleId: ScaleId, tare: TareRequest): TareState;
}
