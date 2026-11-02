/**
 * ScaleDevice — the aggregate root.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONLY PLACE A READING ENTERS THE DOMAIN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every reading passes through `acceptReading`, which is the only
 * mutator that may set the current reading. S-3 is enforced there and
 * nowhere else.
 *
 * LIVE STATE, NOT AN AUDIT RECORD
 * -------------------------------
 * A device's status changes constantly. It is held in memory and
 * overwritten, not appended to — persisting it would let a stale status
 * be read back after a restart, which is the same failure mode the
 * missing reading repository prevents.
 *
 * ONLY THE LAST ACCEPTED READING IS RETAINED
 * ------------------------------------------
 * A late consumer gets NO backlog. Replaying a backlog would present
 * stale readings as current — the exact confusion S-1 exists to prevent.
 */
import { ScaleId } from '../value-objects/scale-id.js';
import { ScaleReading } from '../value-objects/scale-reading.js';
import { ReadingSequence } from '../value-objects/reading-sequence.js';
import type { LinkState } from '../value-objects/link-state.js';
import type { ScaleStatus } from '../value-objects/scale-status.js';
import type { CalibrationState } from '../value-objects/calibration-state.js';
import type { ScaleCapability } from '../value-objects/scale-capability.js';
import { ScaleHealthPolicy, type WeighingVerdict } from '../services/scale-health-policy.js';

export class ScaleDevice {
  private link: LinkState = 'UNKNOWN';
  private selfReportedStatus: ScaleStatus = 'CONNECTED';
  private lastReading: ScaleReading | null = null;
  private latestSequence: ReadingSequence | null = null;
  private linkedAt: Date;

  constructor(
    readonly id: ScaleId,
    readonly label: string,
    readonly capability: ScaleCapability,
    private calibration: CalibrationState,
    linkedAt: Date,
  ) {
    this.linkedAt = linkedAt;
  }

  get linkState(): LinkState {
    return this.link;
  }

  get status(): ScaleStatus {
    // S-5: the link OVERRIDES the device's self-report. A device that
    // is not there cannot be believed about its own status.
    if (this.link !== 'UP') {
      return 'DISCONNECTED';
    }
    return this.selfReportedStatus;
  }

  get reportedStatus(): ScaleStatus {
    /** The device's own report, unmediated. */
    return this.selfReportedStatus;
  }

  get lastAcceptedReading(): ScaleReading | null {
    return this.lastReading;
  }

  get lastSequence(): ReadingSequence | null {
    return this.latestSequence;
  }

  get calibrationState(): CalibrationState {
    return this.calibration;
  }

  get connectedSince(): Date {
    return this.linkedAt;
  }

  /**
   * The current weight, OR the fact that there is none.
   *
   * S-1: the `NONE` branch has no value field, so a caller cannot read a
   * zero out of a silent device.
   */
  snapshot(now: Date): { readonly kind: 'READING'; readonly reading: ScaleReading } | {
    readonly kind: 'NONE';
    readonly since: Date;
    readonly reason: 'NEVER_READ' | 'DISCONNECTED';
  } {
    if (this.link !== 'UP') {
      return {
        kind: 'NONE',
        since: this.lastReading?.receivedAt ?? this.linkedAt,
        reason: this.lastReading === null ? 'NEVER_READ' : 'DISCONNECTED',
      };
    }
    if (this.lastReading === null) {
      return { kind: 'NONE', since: this.linkedAt, reason: 'NEVER_READ' };
    }
    return { kind: 'READING', reading: this.lastReading };
  }

  /**
   * Accept a reading, if it is in sequence.
   *
   * Returns true when the reading was accepted. A rejected reading is
   * NOT applied — the previous reading remains the latest valid one.
   *
   * ACCEPTING A READING BRINGS THE LINK UP. A device that has been
   * silent and then speaks is, by definition, being heard from again.
   * This is the only way the link returns to UP — there is no separate
   * "reconnect" path that could be taken without a reading, because a
   * reading is the only evidence that a device is present (S-1).
   */
  acceptReading(
    reading: ScaleReading,
    isAcceptable: (candidate: ScaleReading) => boolean,
  ): boolean {
    if (!isAcceptable(reading)) {
      return false;
    }
    this.lastReading = reading;
    this.latestSequence = reading.sequence;
    this.linkedAt = reading.receivedAt;
    this.markUp(reading.receivedAt);
    return true;
  }

  /** The link has gone silent. */
  markDown(): void {
    if (this.link === 'UP') {
      this.link = 'DOWN';
    }
  }

  /** A reading arrived after a disconnection — the link is back. */
  markUp(receivedAt: Date): void {
    if (this.link !== 'UP') {
      this.link = 'UP';
      this.linkedAt = receivedAt;
    }
  }

  /** The device reports a status of its own. */
  reportStatus(status: ScaleStatus): void {
    this.selfReportedStatus = status;
  }

  /** The device's calibration state has been read or re-issued. */
  updateCalibration(calibration: CalibrationState): void {
    this.calibration = calibration;
  }

  /**
   * May a weighing proceed on this device?
   *
   * S-7: the single chokepoint. The gate lives here, at the device
   * boundary, so a caller that forgets to check it is a test-time
   * failure rather than a silent bypass.
   */
  canWeigh(policy: ScaleHealthPolicy): WeighingVerdict {
    return policy.evaluate(this.link, this.status, this.calibration);
  }
}
