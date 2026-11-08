/**
 * ConsumeWeightStream — the reading path.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ACCEPT, UPDATE, OR DISCARD. AND A DISCARD CHANGES NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The rules are the session's, and the session applies them. This use case
 * **passes the reading on** and **reports what happened** — because a
 * discarded reading must not make the operator's readout say "0 g" when
 * the scale is actually reading 40 g.
 *
 * AND THE SCALE'S DISCONNECTION IS UNIT 004's TO DETECT
 * --------------------------------------------------
 * BRD IR-13 requires the weighing to be blocked within 2 s of a
 * disconnection, and unit `004` already detects it: the watchdog trips on
 * the device's silence and the registry's link state goes down.
 *
 * **So this unit reads the link state — it does not implement a second
 * watchdog.** A second watchdog would be a second answer to a question
 * unit `004` already answers, and the duplication ADR-028 refused for the
 * MES seam.
 *
 * And when the link goes down, the **last known weight is retained for
 * display and marked stale** — the operator can still see what the scale
 * last said, and the UI can mark it as old.
 */
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ReadingSequence } from '../../../004-scale-integration/domain/value-objects/reading-sequence.js';
import type { WeighingSessionRepository } from '../../domain/ports/weighing-station-ports.js';

export type ConsumeReadingOutcome =
  | {
      readonly kind: 'ACCEPTED';
      readonly weight: WeightValue;
      readonly stable: boolean;
    }
  | {
      /** The reading was discarded, and **nothing changed**. */
      readonly kind: 'DISCARDED';
      readonly reason: string;
    }
  | {
      /** The scale has gone away — weighing is blocked. */
      readonly kind: 'SCALE_LOST';
      readonly scaleId: string;
    }
  | {
      /** There is no session — nothing to read into. */
      readonly kind: 'NO_SESSION';
    };

export interface ConsumeWeightStreamOptions {
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
  /**
   * Whether a device may weigh — unit 004's gate.
   *
   * The gate is consulted on the **reading's** device, not the session's
   * bound one: a reading from a device that has gone away is a signal that
   * it HAS gone away, and the session must learn that.
   */
  readonly canWeigh: (scaleId: ScaleId) => { allowed: boolean };
  /**
   * Convert a weight into another unit, **exactly**.
   *
   * Unit 004's `WeightUnitConverter` — decimal, never a float division.
   *
   * **And the conversion is REQUIRED, not optional.** The recipe's
   * components carry the unit the MES supplied — some in grams, some in
   * kilograms — while a scale reports in its own unit. The floor scale
   * reports grams and the recipe's auxiliary components are in kilograms,
   * so a comparison without a conversion would be comparing `9.6000 kg`
   * against `9600.0000 g` and refusing the weighing of every auxiliary in
   * the recipe.
   *
   * And the conversion must be **exact**: `1.850 kg` becomes `1850 g`, not
   * `1849.9999999 g` — a fraction of a gram that nobody would see and
   * everybody would inherit.
   */
  readonly convert: (
    value: WeightValue,
    toUnit: string,
  ) => WeightValue | null;
  /** Where a failure's diagnostic goes. The detail never reaches the client. */
  readonly onError?: (detail: string) => void;
}

export class ConsumeWeightStream {
  constructor(private readonly options: ConsumeWeightStreamOptions) {}

  /**
   * Offer a reading to the session.
   *
   * @param scaleId The device the reading came from.
   * @param weight The reading's value — **already net of the tare**, because
   *   the tare is applied at the device and the reading carries it
   *   (ADR-014). There is nothing left to subtract.
   * @param stable Whether the weight has settled. It is **surfaced**, not
   *   collapsed (BRD IR-11).
   * @param sequence The device's strictly increasing counter — the
   *   out-of-order guard.
   */
  async offer(
    scaleId: ScaleId,
    weight: WeightValue,
    stable: boolean,
    sequence: ReadingSequence,
  ): Promise<ConsumeReadingOutcome> {
    const session = this.options.sessions.current();
    if (session === null) {
      return { kind: 'NO_SESSION' };
    }

    // THE DISCONNECTION. Unit 004's watchdog has already detected it; this
    // unit reads the gate's verdict.
    if (!this.options.canWeigh(scaleId).allowed) {
      session.scaleLost();
      await this.options.sessions.save(session);
      this.options.onError?.(
        `[weighing-station] the scale ${scaleId.value} is not weighing; the session is blocked`,
      );
      return { kind: 'SCALE_LOST', scaleId: scaleId.value };
    }

    // THE CONVERSION. The reading is in the DEVICE's unit and the component's
    // target is in the RECIPE's unit — and the recipe mixes them: the
    // dyestuff components are in grams and the auxiliaries in kilograms.
    //
    // So the reading is converted into the component's unit, EXACTLY, before
    // the session compares it. Without the conversion the comparison would
    // throw — and a thrown comparison is a 500, not a refusal.
    const targetUnit = session.componentUnit;
    const comparable =
      targetUnit === null || weight.unit === targetUnit
        ? weight
        : (this.options.convert(weight, targetUnit) ?? weight);

    const outcome = session.offerReading(
      scaleId,
      comparable,
      stable,
      sequence,
    );

    if (outcome.kind === 'DISCARDED') {
      // A DISCARD CHANGES NOTHING. The current weight is retained.
      this.options.onError?.(
        `[weighing-station] a reading was discarded: ${outcome.reason}`,
      );
      return { kind: 'DISCARDED', reason: outcome.reason };
    }

    await this.options.sessions.save(session);
    return { kind: 'ACCEPTED', weight: outcome.weight, stable };
  }
}
