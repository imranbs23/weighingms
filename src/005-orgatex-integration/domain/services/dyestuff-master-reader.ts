/**
 * DyestuffMasterReader — the narrow read of the MES's lot for a component.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE QUESTION, NOT A MASTER-DATA READ.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The BRD's IR-03 asks for the dyestuff master data, and the story that
 * owns it — *"002-verify-dyestuff-identity-by-scan-or-attestation"* and
 * *"003-capture-and-validate-dyestuff-lot"* — is **unit 002's**. So the
 * read belongs to this unit.
 *
 * But the read is **deliberately narrow**: it asks one question —
 * *"does the MES hold a lot for this component, and if so which?"* — and it
 * asks it over the **existing seam**.
 *
 * WHY NOT A FULL MASTER READ
 * --------------------------
 * A full master read would carry the name, the colour, the barcode and
 * every lot the MES knows. It would also be a **second contact** and a
 * **second cache** for one component's facts — the duplication ADR-032
 * refused for the recipe, where the same reasoning applies.
 *
 * And the caller needs exactly one answer. So this reader returns the lot
 * or nothing.
 *
 * AND "NO LOT" IS NOT A FAILURE
 * -----------------------------
 * A component without a source-held lot is the **normal** case for the
 * scan and keyed-in paths. So `NO_LOT` is its own outcome, distinct from
 * `UNAVAILABLE` — and the difference matters, because under `UNAVAILABLE`
 * the operator's paths remain available *and* the operator is told the MES
 * could not be reached, while under `NO_LOT` nothing was wrong at all.
 *
 * AND THE LOT IS NOT CACHED
 * -------------------------
 * The recipe's last-known-good is cached because the recipe is the thing
 * the operator weighs against. The lot is not: it is one field of one
 * component, it is captured **once**, and the capture is what is durable
 * (ADR-034). A cached lot would be a second source of truth for a value
 * that has already been recorded.
 */
import { BatchId } from '../value-objects/identifiers.js';
import { ComponentId } from '../value-objects/identifiers.js';
import {
  AdapterError,
  type OrgatexAdapter,
  type RawDyestuffLot,
} from '../ports/orgatex-adapter.js';

export type DyestuffLotReadOutcome =
  | {
      /** The MES holds a lot for this component. */
      readonly kind: 'LOT_HELD';
      readonly lotNumber: string;
    }
  | {
      /**
       * The MES holds **no** lot for this component.
       *
       * Not a failure — it is the normal case for the operator's paths.
       */
      readonly kind: 'NO_LOT';
    }
  | {
      /** The MES could not be reached. */
      readonly kind: 'UNAVAILABLE';
      readonly reason: 'UNREACHABLE' | 'TIMEOUT';
      /** For the LOG, never for the client (BRD IR-09). */
      readonly message: string;
    };

export interface DyestuffMasterReaderOptions {
  readonly adapter: OrgatexAdapter;
  /**
   * Which adapter produced the answer.
   *
   * A name, not a class — so a test can prove the attribution without
   * depending on which adapter is bound.
   */
  readonly source: string;
}

export class DyestuffMasterReader {
  constructor(private readonly options: DyestuffMasterReaderOptions) {}

  /**
   * Read the lot the MES holds for a component.
   *
   * @param batchId The batch the component belongs to.
   * @param componentId The component.
   */
  async readLot(
    batchId: BatchId,
    componentId: ComponentId,
  ): Promise<DyestuffLotReadOutcome> {
    let raw: RawDyestuffLot;
    try {
      raw = await this.options.adapter.readDyestuffLot(batchId, componentId);
    } catch (error) {
      if (error instanceof AdapterError) {
        if (error.reason === 'NOT_FOUND') {
          // The MES was REACHED and holds no lot for this component. That
          // is a successful contact with a negative answer — never a
          // failure of the link.
          return { kind: 'NO_LOT' };
        }
        if (error.reason === 'UNREACHABLE' || error.reason === 'TIMEOUT') {
          return {
            kind: 'UNAVAILABLE',
            reason: error.reason,
            message: error.message,
          };
        }
      }
      return {
        kind: 'UNAVAILABLE',
        reason: 'UNREACHABLE',
        message: (error as Error).message,
      };
    }

    // The MES answered with a lot. An empty lot is **no lot** — the same
    // fact, in the MES's own spelling.
    const lot = raw.lotNumber.trim();
    if (lot.length === 0) {
      return { kind: 'NO_LOT' };
    }

    return { kind: 'LOT_HELD', lotNumber: lot };
  }
}
