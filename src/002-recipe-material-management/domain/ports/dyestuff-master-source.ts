/**
 * DyestuffMasterSource — the seam through which the MES's lot is read.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE NARROW QUESTION, NOT A MASTER-DATA READ.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The alternative — a full dyestuff-master read, with the name, the colour
 * and every lot the MES knows — would be a **second contact** and a
 * **second cache** for one component's facts, which is the duplication
 * ADR-032 refused for the recipe.
 *
 * This bolt needs exactly one answer: *"does the MES hold a lot for this
 * component, and if so which?"*
 *
 * AND "NO LOT" IS NOT A FAILURE
 * -----------------------------
 * A component without a source-held lot is the **normal** case for the
 * scan and keyed-in paths. So the outcome carries three kinds:
 *
 * | Outcome | Meaning |
 * |---|---|
 * | `LOT_HELD` | The MES holds a lot for this component |
 * | `NO_LOT` | The MES holds **no** lot — the scan and keyed-in paths apply |
 * | `UNAVAILABLE` | The MES could not be reached |
 *
 * `NO_LOT` and `UNAVAILABLE` are different facts, and they produce
 * different behaviour: under `NO_LOT` the operator's value is captured as
 * `SCAN` or `KEYED_IN`; under `UNAVAILABLE` the operator's value is **also**
 * captured, but the operator is told the MES could not be reached — because
 * a lot the MES holds may exist, and the capture method then records that
 * the lot was **not** source-held.
 *
 * The port is owned by **this** unit — the consumer — and unit `005`'s
 * reader satisfies it structurally (ADR-028, ADR-032).
 */
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export type DyestuffLotLookupOutcome =
  | {
      readonly kind: 'LOT_HELD';
      /** The lot the MES holds. */
      readonly lotNumber: string;
    }
  | {
      /** The MES holds no lot for this component. Not a failure. */
      readonly kind: 'NO_LOT';
    }
  | {
      /** The MES could not be reached. */
      readonly kind: 'UNAVAILABLE';
      readonly reason: 'UNREACHABLE' | 'TIMEOUT';
      /** For the LOG, never for the client (BRD IR-09). */
      readonly message: string;
    };

export interface DyestuffMasterSource {
  /**
   * Ask the MES whether it holds a lot for this component.
   *
   * @returns The outcome. A failure is **returned**, not thrown.
   */
  readLot(componentId: ComponentId): Promise<DyestuffLotLookupOutcome>;
}
