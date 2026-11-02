/**
 * TarePolicy — the pure rule for "may a tare be applied?".
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * S-13: a tare may only be applied to a device that can be WEIGHED ON.
 *
 * The policy consults the SAME gate the weighing does — it takes the
 * `WeighingVerdict` the device produced, rather than evaluating the
 * link, calibration and status itself. That is deliberate: a second,
 * parallel implementation of "is this device usable" would be a second
 * place for the rule to drift, and the tare would then be refused for
 * reasons the weighing would not recognise (or the reverse).
 *
 * The consequence is that a tare is refused for exactly the reasons a
 * weighing is refused, and the vocabulary is one vocabulary.
 *
 * WHY THIS POLICY COMPUTES NOTHING
 * ---------------------------------
 * The tare's VALUE is arithmetic, and arithmetic belongs to the adapter
 * (ADR-014 — the adapter is the one place a tare is applied). This policy
 * decides only whether the operation may proceed.
 */
import type { ScaleDevice } from '../entities/scale-device.js';
import type { WeighingVerdict } from './scale-health-policy.js';

export type TareVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WeighingVerdict['reason'] };

export class TarePolicy {
  /**
   * May a tare be applied to this device?
   *
   * @param device  The device the tare would be applied to.
   * @param verdict The weighing gate's verdict for that device.
   */
  evaluate(device: ScaleDevice, verdict: WeighingVerdict): TareVerdict {
    if (verdict.allowed) {
      return { allowed: true };
    }
    return { allowed: false, reason: verdict.reason };
  }
}
