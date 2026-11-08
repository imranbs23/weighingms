/**
 * The adapter that binds unit 005's master reader to unit 002's port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A THIN SHIM, AND THE THINNESS IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `005`'s `DyestuffMasterReader` asks for a `BatchId` and a
 * `ComponentId` and returns a `DyestuffLotReadOutcome`. Unit `002`'s port
 * asks for a `ComponentId` and returns a `DyestuffLotLookupOutcome`.
 *
 * The two shapes differ for one reason: **unit `002` does not know the
 * batch**. A component id identifies a slot in a recipe, and the recipe
 * belongs to a batch — so the batch id is on the **working copy**, and the
 * port asks for it there.
 *
 * So the adapter's job is to supply the batch id from the working copy and
 * to translate the outcome. It is a **shim**, not a mapper: there is no
 * second source of truth, no second cache, and no second contact — the
 * reader underneath is the same one (ADR-032).
 */
import type { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { DyestuffMasterReader } from '../../../005-orgatex-integration/domain/services/dyestuff-master-reader.js';
import type {
  DyestuffLotLookupOutcome,
  DyestuffMasterSource,
} from '../../domain/ports/dyestuff-master-source.js';
import type { RecipeWorkingCopy } from '../../domain/services/recipe-working-copy.js';

export class OrgatexDyestuffMasterAdapter implements DyestuffMasterSource {
  constructor(
    private readonly reader: DyestuffMasterReader,
    private readonly workingCopy: RecipeWorkingCopy,
  ) {}

  async readLot(
    componentId: Parameters<DyestuffMasterReader['readLot']>[1],
  ): Promise<DyestuffLotLookupOutcome> {
    // The batch comes from the working copy — the recipe the station is
    // working. With no recipe loaded there is no batch to ask about.
    const recipe = this.workingCopy.current();
    if (recipe === null) {
      return { kind: 'NO_LOT' };
    }

    const outcome = await this.reader.readLot(
      recipe.batchId as BatchId,
      componentId,
    );

    switch (outcome.kind) {
      case 'LOT_HELD':
        return { kind: 'LOT_HELD', lotNumber: outcome.lotNumber };
      case 'NO_LOT':
        return { kind: 'NO_LOT' };
      case 'UNAVAILABLE':
        return {
          kind: 'UNAVAILABLE',
          reason: outcome.reason,
          message: outcome.message,
        };
    }
  }
}
