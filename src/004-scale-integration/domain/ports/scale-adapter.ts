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
}
