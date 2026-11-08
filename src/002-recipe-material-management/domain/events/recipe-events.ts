/**
 * The domain events of the recipe load.
 *
 * ══════════════════════════════════════════════════════════════════════
 * AN EVENT NAMES SOMETHING THAT HAPPENED. IT IS NOT A NOTIFICATION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `RecipeLoaded` says a recipe was read and became the working copy.
 * `RecipeLoadFailed` says a read did not produce one.
 *
 * Neither carries a **message**. The diagnostic goes to the log and the
 * **reason code** is the payload — BRD IR-09's rule, and the same one the
 * queue's read outcome follows. A reason code is a closed set, so a consumer
 * can act on it; a message is prose, and prose at this boundary is the UI's
 * job (BRD NFR-11).
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export type RecipeEvent =
  | {
      readonly kind: 'RECIPE_LOADED';
      readonly batchId: BatchId;
      readonly shadeCode: string;
      readonly componentCount: number;
      readonly receivedAt: Instant;
      readonly source: string;
      /** Unit `005`'s freshness decision, carried through unchanged. */
      readonly freshnessKind: 'CURRENT' | 'STALE';
    }
  | {
      readonly kind: 'RECIPE_LOAD_FAILED';
      readonly batchId: BatchId;
      /** A closed set of reason codes. Never prose. */
      readonly reason: 'NOT_FOUND' | 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT';
      readonly at: Instant;
    };
