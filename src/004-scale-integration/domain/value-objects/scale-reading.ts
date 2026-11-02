/**
 * ScaleReading — one reading from a device.
 *
 * The unit's contract. Carries the five fields the story pins, plus the
 * tare that was in force when the reading was produced:
 *
 *   value      — a fixed-point decimal (BRD NFR-16), NET of the tare
 *   unit       — the unit the value is in
 *   stable     — true only for a SETTLED weight (BRD IR-11)
 *   sequence   — strictly increasing per device (S-3)
 *   receivedAt — stamped on RECEIPT by the adapter, never by the device
 *   tare       — the tare in force when the reading was produced, or null
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE VALUE IS NET, AND THE READING CARRIES ITS TARE (ADR-014)
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is a BREAKING CHANGE to the reading's shape, and it is the
 * correct one. Bolt `003`'s reading was gross, because there was no
 * tare. Bolt `004` introduces the tare, so the reading must express it.
 *
 * The tare is applied ONCE, at the device, and it PERSISTS into every
 * subsequent reading. A consumer that subtracted the tare from its own
 * copy would have to know whether the device had already done it — and
 * would double-subtract whenever a second consumer attached mid-session,
 * producing a plausible wrong number with no error. So:
 *
 *   - `value` is the NET value: the gross reading minus the tare;
 *   - `tare` is the tare that produced it, or null if none was in force.
 *
 * There is consequently NOTHING LEFT for a consumer to subtract, and no
 * question for two consumers to disagree about.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THE READING CARRIES THE TARE AND NOT JUST THE VALUE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because a consumer can then always answer "what was this reading net
 * of?", and because the tare is VISIBLE IN THE EVIDENCE — a recording
 * of the session is reconstructible. Without the field, a consumer
 * holding a net reading could not tell what tare produced it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY `receivedAt` IS NOT THE DEVICE'S TIMESTAMP
 * ══════════════════════════════════════════════════════════════════════
 * The device's clock is not the station's clock. A scale with a skewed
 * clock would produce readings whose receipt times are out of order, and
 * the watchdog — which measures silence from the last reading's receipt
 * time — would be measuring the device's drift rather than the device's
 * silence. So the adapter stamps the arrival, and the reading carries
 * that.
 *
 * A reading of exactly zero is LEGITIMATE. What distinguishes it from "no
 * reading" is its presence, never its value (S-1) — and the type that
 * carries a reading is a different type from the one that carries its
 * absence.
 */
import { WeightValue } from './weight-value.js';
import { ReadingSequence } from './reading-sequence.js';
import type { TareState } from '../entities/tare-state.js';

export class ScaleReading {
  constructor(
    /** The NET value — the gross reading minus the tare in force. */
    readonly value: WeightValue,
    readonly stable: boolean,
    readonly sequence: ReadingSequence,
    readonly receivedAt: Date,
    /**
     * The tare in force when this reading was produced, or null when no
     * tare was in force.
     *
     * The tare is a SNAPSHOT, and `TareState` is immutable — so holding
     * the reference is safe. A later re-tare does not rewrite what this
     * reading was net of.
     */
    readonly tare: TareState | null = null,
  ) {}
}
