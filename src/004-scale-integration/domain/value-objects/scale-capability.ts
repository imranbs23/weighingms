/**
 * ScaleCapability — what the device CAN do.
 *
 * Owned by this unit, USED by bolt `004` for the selection rule. The
 * selection rule itself belongs to bolt `004`; this is only the set of
 * facts the rule needs.
 *
 * The capacities and resolutions come from the prototype's own status
 * strip, which lists the two scales separately:
 *
 *   SCALE-A — precision, 3 kg, 1 g    — dyestuffs, small exact quantities
 *   SCALE-B — floor,    32 kg, 10 g   — dry auxiliaries
 *
 * `capacity` and `resolution` are `WeightValue`s, so they carry a unit
 * and cannot be compared across mixed units by accident.
 */
import { WeightValue } from './weight-value.js';

export type ScaleClass = 'PRECISION' | 'FLOOR';

export class ScaleCapability {
  constructor(
    readonly scaleClass: ScaleClass,
    readonly capacity: WeightValue,
    readonly resolution: WeightValue,
  ) {}
}
