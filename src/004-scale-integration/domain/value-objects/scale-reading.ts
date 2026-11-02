/**
 * ScaleReading — one reading from a device.
 *
 * The unit's contract. Carries exactly the five fields the story pins:
 *
 *   value      — a fixed-point decimal (BRD NFR-16)
 *   unit       — the unit the value is in
 *   stable     — true only for a SETTLED weight (BRD IR-11)
 *   sequence   — strictly increasing per device (S-3)
 *   receivedAt — stamped on RECEIPT by the adapter, never by the device
 *
 * WHY `receivedAt` IS NOT THE DEVICE'S TIMESTAMP
 * -----------------------------------------------
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

export class ScaleReading {
  constructor(
    readonly value: WeightValue,
    readonly stable: boolean,
    readonly sequence: ReadingSequence,
    readonly receivedAt: Date,
  ) {}
}
