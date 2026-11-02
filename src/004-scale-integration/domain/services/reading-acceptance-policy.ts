/**
 * ReadingAcceptancePolicy — the pure rule for accepting a reading.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * S-3: a reading's sequence must be STRICTLY GREATER than the last
 * accepted one. This is the only place a reading is allowed in, and this
 * is the only implementation of that rule.
 *
 * "Strictly greater" rather than "greater or equal" means a REPEATED
 * sequence is rejected — and a repeated sequence is what a device that
 * has restarted (and reset its counter) produces. The story's edge case
 * is explicit: a device that reconnects with a sequence "not greater than
 * the last" is rejected and "the device stays DISCONNECTED until a
 * strictly greater sequence number arrives".
 */
import { ScaleReading } from '../value-objects/scale-reading.js';
import { ReadingSequence } from '../value-objects/reading-sequence.js';

export interface ReadingVerdict {
  readonly accepted: boolean;
  /** Why it was rejected — null when accepted. */
  readonly rejection: ReadingRejection | null;
}

export type ReadingRejection = 'OUT_OF_ORDER';

export class ReadingAcceptancePolicy {
  /**
   * May this candidate reading be accepted?
   *
   * @param candidate   The reading the adapter produced.
   * @param lastAccepted The last accepted reading's sequence, or null if
   *                     this device has never delivered an accepted
   *                     reading.
   */
  evaluate(
    candidate: ScaleReading,
    lastAccepted: ReadingSequence | null,
  ): ReadingVerdict {
    if (lastAccepted === null) {
      return { accepted: true, rejection: null };
    }
    if (!candidate.sequence.isGreaterThan(lastAccepted)) {
      return { accepted: false, rejection: 'OUT_OF_ORDER' };
    }
    return { accepted: true, rejection: null };
  }
}
