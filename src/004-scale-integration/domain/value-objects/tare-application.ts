/**
 * TareApplication — the OUTCOME of a tare request.
 *
 * A DISCRIMINATED UNION, so the two cases cannot be confused and the
 * refusal cannot be mishandled.
 *
 * WHY THE REFUSAL CARRIES NO NEW STATE
 * -----------------------------------
 * S-14: a refused tare leaves the PREVIOUS tare in force. The `REFUSED`
 * branch therefore carries only a reason and NO state — so a caller that
 * handles a refusal by, say, updating its own view of the device's tare
 * has nothing to update it WITH. The previous tare cannot be lost by
 * handling a refusal incorrectly, because there is no new tare to lose.
 *
 * The reasons are the SAME `WeighingBlockReason` set the weighing gate
 * uses, so the vocabulary is one vocabulary. A tare is refused for
 * exactly the reasons a weighing is refused, because it consults the
 * same gate (S-13).
 */
import type { TareState } from '../entities/tare-state.js';
import type { WeighingBlockReason } from '../value-objects/weighing-block-reason.js';

export type TareApplication =
  | { readonly kind: 'APPLIED'; readonly state: TareState }
  | { readonly kind: 'REFUSED'; readonly reason: WeighingBlockReason };
