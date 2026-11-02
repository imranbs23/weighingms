/**
 * ScaleHealthPolicy — the pure rule for "may a weighing proceed?".
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * S-7: the weighing gate lives in ONE place, at the device boundary, so
 * that a caller which forgets to check it is a test-time failure rather
 * than a silent bypass. This is the same single-chokepoint property
 * ADR-003 and ADR-004 established for the identity unit.
 *
 * It returns the REASON rather than a boolean, because the story requires
 * the refusal to name the reason ("a stated reason identifies the scale
 * as disconnected"). A boolean would make the caller responsible for
 * knowing which check failed.
 *
 * THE ORDER OF THE CHECKS MATTERS
 * -------------------------------
 * The order is from "most fundamental" to "most specific", so the reason
 * names the FIRST thing that was wrong:
 *
 *   1. the link       — is the device there at all?
 *   2. the calibration — is it trustworthy?
 *   3. the load      — can it take the weight?
 *
 * A disconnected device is reported as disconnected, not as
 * out-of-calibration: the calibration state of a device we cannot reach
 * is not the fact the operator needs.
 */
import type { LinkState } from '../value-objects/link-state.js';
import type { ScaleStatus } from '../value-objects/scale-status.js';
import type { CalibrationState } from '../value-objects/calibration-state.js';
import type { WeighingBlockReason } from '../value-objects/weighing-block-reason.js';

export interface WeighingVerdict {
  readonly allowed: boolean;
  /** The reason a weighing is blocked — null when allowed. */
  readonly reason: WeighingBlockReason | null;
}

export class ScaleHealthPolicy {
  /**
   * May a weighing proceed on this device?
   *
   * @param link         The link axis (ADR-011).
   * @param status       The device's self-reported status.
   * @param calibration  The device's calibration state.
   */
  evaluate(
    link: LinkState,
    status: ScaleStatus,
    calibration: CalibrationState,
  ): WeighingVerdict {
    // 1. THE LINK. A device we cannot hear from cannot be weighed on.
    //
    //    `UNKNOWN` and `DOWN` both block, but they are DIFFERENT facts:
    //    a device that never spoke is not the same as one that went
    //    silent, and the reason says which (ADR-011).
    if (link === 'DOWN') {
      return { allowed: false, reason: 'SCALE_DISCONNECTED' };
    }
    if (link === 'UNKNOWN') {
      return { allowed: false, reason: 'SCALE_NOT_RESPONDING' };
    }

    // 2. THE CALIBRATION. A scale that cannot be trusted must not
    //    produce a weight that will be recorded as fact.
    if (calibration.kind === 'EXPIRED') {
      return { allowed: false, reason: 'CALIBRATION_EXPIRED' };
    }

    // 3. THE LOAD. These are the device's own reports.
    if (status === 'OVER_CAPACITY') {
      return { allowed: false, reason: 'OVER_CAPACITY' };
    }
    if (status === 'BUSY') {
      return { allowed: false, reason: 'SCALE_BUSY' };
    }

    // ADR-010: `ZEROED` is a state of READINESS, not a fault. A tared
    // scale is zeroed, and tare exists to enable the weighing — so a
    // zeroed scale is ALLOWED.
    return { allowed: true, reason: null };
  }
}
