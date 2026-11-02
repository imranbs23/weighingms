/**
 * DummyScaleAdapter — the TRAINING scale.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS A PRODUCT SURFACE, NOT A TEST FIXTURE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The unit brief is explicit: "the training device is the Dummy Scale, a
 * product surface rather than a test fixture, exercised by the test suite
 * and independently callable."
 *
 * It produces EXACTLY the contract the product depends on — a continuous
 * stream at ≥ 10 Hz, carrying a value, a unit, a stability flag, a
 * strictly increasing sequence and a receipt time — so that assumption
 * A-05 is TESTABLE rather than merely stated.
 *
 * THE Q-03 SEAM
 * -------------
 * If FCI's answer is that the real indicators report only a SETTLED value,
 * then a real adapter emits one reading per settle event instead of ten
 * per second, and `stable` becomes the only meaningful signal. Nothing
 * above this class changes. That is the whole point of the seam.
 *
 * NO PROTOCOL IS ASSERTED
 * -----------------------
 * The indicator's make, model and protocol are unconfirmed (Q-03), so this
 * class asserts none. It is not "an RS232 scale" or "a Modbus scale" —
 * it is a training device that produces the unit's contract.
 */
import type { ScaleAdapter, TareRequest } from '../../domain/ports/scale-adapter.js';
import type { ScaleId } from '../../domain/value-objects/scale-id.js';
import { ScaleReading } from '../../domain/value-objects/scale-reading.js';
import { WeightValue } from '../../domain/value-objects/weight-value.js';
import { ReadingSequence } from '../../domain/value-objects/reading-sequence.js';
import type { ScaleStatus } from '../../domain/value-objects/scale-status.js';
import type { CalibrationState } from '../../domain/value-objects/calibration-state.js';
import { DispenseRamp, type RampLanding } from '../../domain/services/dispense-ramp.js';
import { TareState } from '../../domain/entities/tare-state.js';
import { Instant } from '../../domain/value-objects/instant.js';
import { Decimal } from 'decimal.js';

export interface DummyScaleConfig {
  readonly scaleId: ScaleId;
  readonly unit: string;
  /** The sampling interval. IR-10 requires ≤ 100 ms. */
  readonly sampleIntervalMs: number;
  /** The weight the device reports when idle. */
  readonly idleWeight: string;
  /** The device's self-reported status. */
  readonly status: ScaleStatus;
  readonly calibration: CalibrationState;
}

export class DummyScaleAdapter implements ScaleAdapter {
  private sequence = 0;
  private current: WeightValue;
  private running = false;
  private pumping = false;
  private silenced = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly ramp = new DispenseRamp();
  private rampState: {
    target: WeightValue;
    tolerance: WeightValue;
    mode: RampLanding;
  } | null = null;

  /**
   * The tare in force on this device, or null when none is.
   *
   * Held here because this adapter is the one place the tare is
   * APPLIED (ADR-014). The device aggregate holds the same state for
   * the same reason — it is what the status view and the API report —
   * and the two are the same object, because `applyTare` returns the
   * state it applied and the registry puts THAT on the device.
   */
  private tare: TareState | null = null;

  constructor(
    private readonly config: DummyScaleConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.current = WeightValue.of(config.idleWeight, config.unit);
  }

  /**
   * The live weight stream.
   *
   * Yields a reading every `sampleIntervalMs`. The receipt time is
   * stamped HERE — on arrival — not taken from the device, because the
   * device's clock is not the station's clock (S-6).
   *
   * ══════════════════════════════════════════════════════════════════
   * A SILENCED DEVICE YIELDS NOTHING. IT DOES NOT YIELD ZERO.
   * ══════════════════════════════════════════════════════════════════
   *
   * This is the whole point of the silence control. A device that has
   * gone away must be ABSENT from the stream, not present with a weight
   * of zero — otherwise the operator is told a scale is reading 0 g when
   * in fact it is not there at all (S-1).
   *
   * The sequence number is NOT consumed while silenced, so the readings
   * that follow the silence are still strictly greater than the ones
   * before it (S-3).
   */
  async *openStream(scaleId: ScaleId): AsyncIterable<ScaleReading> {
    this.running = true;
    while (this.running) {
      await this.delay(this.config.sampleIntervalMs);
      if (!this.running) break;
      if (this.silenced) continue;
      this.advanceRamp();
      yield this.read();
    }
  }

  /**
   * Stop emitting readings — the device "goes away".
   *
   * The stream stays OPEN. A consumer must be able to watch a scale go
   * down and come back on ONE connection.
   */
  silence(): void {
    this.silenced = true;
  }

  /** Start emitting readings again. */
  unsilence(): void {
    this.silenced = false;
  }

  /** Is the device currently silenced? */
  isSilenced(): boolean {
    return this.silenced;
  }

  /**
   * Is the adapter already streaming?
   *
   * The adapter's stream is SHARED: one pump per device feeds the
   * registry, and the registry broadcasts to every subscriber. A second
   * subscriber must NOT start a second pump, or the device would emit two
   * interleaved sequences and every reading would look out-of-order.
   */
  isPumping(): boolean {
    return this.pumping;
  }

  /** Claim the pump. Returns false if another caller already has it. */
  startPumping(): boolean {
    if (this.pumping) return false;
    this.pumping = true;
    return true;
  }

  /** Produce one reading now. */
  read(): ScaleReading {
    this.sequence += 1;
    const net = this.applyTareToGross(this.current);
    return new ScaleReading(
      net,
      net.isZero(),
      ReadingSequence.of(this.sequence),
      this.clock(),
      this.tare,
    );
  }

  /**
   * Produce ONE reading, synchronously.
   *
   * The tare flow uses this to prove the device is there before it
   * commands it: a device that has never spoken cannot be tare'd.
   *
   * A SILENCED DEVICE PRODUCES NOTHING — here as in the stream (S-1).
   * A device that has gone away must be ABSENT, not present with a
   * weight of zero. So a silenced device returns `null`, and the tare
   * flow treats that as "the device is not there".
   */
  readOnce(_scaleId: ScaleId): ScaleReading | null {
    if (this.silenced) return null;
    return this.read();
  }

  /**
   * Apply a tare to the device.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE TRAINING DEVICE HAS NO TARE COMMAND (Q-03)
   * ══════════════════════════════════════════════════════════════════
   *
   * The indicator's protocol is unconfirmed, and the training device
   * implements none of it. So the tare is applied IN SOFTWARE — the
   * subtraction happens here, in the adapter, which is the one place a
   * software tare is subtracted (ADR-014).
   *
   * A real adapter that supports a tare command would issue it to the
   * device and return the same `TareState` shape with
   * `appliedBy: 'INDICATOR'`. Nothing above the adapter would change —
   * which is the point of applying the tare at the device.
   */
  applyTare(scaleId: ScaleId, request: TareRequest): TareState {
    const state = new TareState(
      scaleId,
      request.value,
      request.appliedAt,
      request.source,
      'SOFTWARE',
    );
    this.tare = state;
    return state;
  }

  /**
   * Subtract the tare from a gross reading, EXACTLY, and floor at zero.
   *
   * ══════════════════════════════════════════════════════════════════
   * WHY THE RESULT FLOORS AT ZERO (ADR-016)
   * ══════════════════════════════════════════════════════════════════
   *
   * A gross reading below the tare — an empty container removed from a
   * scale zeroed against it — would otherwise produce a negative net
   * weight. A negative dispensed quantity is not a thing that exists, so
   * the negative number is never produced: the clamp is here, at the
   * device, rather than in every consumer that would otherwise have to
   * remember to apply it.
   *
   * The TARE ITSELF is unaffected. Only the net reading floors.
   *
   * The arithmetic is exact — `decimal.js`, never a float (BRD NFR-16).
   */
  private applyTareToGross(gross: WeightValue): WeightValue {
    const tare = this.tare;
    if (tare === null) return gross;

    const net = new Decimal(gross.text).minus(new Decimal(tare.tareValue.text));
    const floored = net.isNegative() ? new Decimal(0) : net;

    return WeightValue.of(stripTrailingZeros(floored.toFixed(6)), gross.unit);
  }

  /**
   * Set the weight the device is showing.
   *
   * TRAINING ONLY — it puts a specific weight on the scale so that a
   * test can exercise the tare subtraction, the ramp or the stream
   * without waiting for a dispense to reach it.
   *
   * The value is GROSS. The tare, if one is in force, is subtracted from
   * it when the reading is produced (ADR-014).
   */
  setWeight(text: string): void {
    this.current = WeightValue.of(text, this.config.unit);
  }

  /**
   * Drive the dispersion ramp.
   *
   * TRAINING ONLY. This is the behaviour the prototype ran in the page's
   * JavaScript, moved here so the UI reads a stream rather than being
   * the source of truth for weight.
   */
  startDispense(
    target: WeightValue,
    tolerance: WeightValue,
    mode: RampLanding,
  ): void {
    this.rampState = { target, tolerance, mode };
  }

  /** Stop the ramp and return to the idle weight. */
  stopDispense(): void {
    this.rampState = null;
    this.current = WeightValue.of(this.config.idleWeight, this.config.unit);
  }

  /** Advance the ramp by one sample — called by the timer. */
  advanceRamp(): void {
    if (this.rampState === null) return;
    const { target, tolerance, mode } = this.rampState;
    const result = this.ramp.step(this.current, target, tolerance, mode);
    this.current = result.value;
    if (result.landed) {
      this.rampState = null;
    }
  }

  readStatus(_scaleId: ScaleId): ScaleStatus {
    return this.config.status;
  }

  readCalibration(_scaleId: ScaleId): CalibrationState {
    return this.config.calibration;
  }

  /** Stop the stream. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

/**
 * Remove the trailing zeros a fixed-point subtraction introduces.
 *
 * `"214.000000"` → `"214"`, `"0.420000"` → `"0.42"`, `"0.000000"` →
 * `"0"`. The result is always a canonical decimal that `WeightValue`
 * accepts.
 *
 * The trailing DOT goes with the zeros: `"1850.000000"` must become
 * `"1850"`, not `"1850.0"`. A value below one keeps its leading zero
 * and at least one decimal place — `"0.5"`, never `".5"`.
 */
function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;

  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  if (trimmed === '' || trimmed === '-') return '0';

  // A value with no integer part keeps one decimal place.
  if (trimmed.startsWith('.')) return `0${trimmed}`;
  if (trimmed.startsWith('-.')) return `-0${trimmed.slice(1)}`;

  return trimmed;
}
