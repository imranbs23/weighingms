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
import type { ScaleAdapter } from '../../domain/ports/scale-adapter.js';
import type { ScaleId } from '../../domain/value-objects/scale-id.js';
import { ScaleReading } from '../../domain/value-objects/scale-reading.js';
import { WeightValue } from '../../domain/value-objects/weight-value.js';
import { ReadingSequence } from '../../domain/value-objects/reading-sequence.js';
import type { ScaleStatus } from '../../domain/value-objects/scale-status.js';
import type { CalibrationState } from '../../domain/value-objects/calibration-state.js';
import { DispenseRamp, type RampLanding } from '../../domain/services/dispense-ramp.js';

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
    return new ScaleReading(
      this.current,
      this.current.isZero(),
      ReadingSequence.of(this.sequence),
      this.clock(),
    );
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
