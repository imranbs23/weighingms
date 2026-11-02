/**
 * SnapshotCache — the last known-good snapshot per key.
 *
 * ══════════════════════════════════════════════════════════════════════
 * IN MEMORY. BOUNDED. DISPOSABLE. NEVER PERSISTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is ADR-021, and the reasoning is worth stating here because the
 * cache is the one place where a future agent might be tempted to "just
 * persist it so it survives a restart".
 *
 * A persisted snapshot would be a **stale-looking-fresh** risk. The
 * snapshot's `receivedAt` is written when it is taken. Read it back after
 * a restart and the age is computed against a clock that has since moved —
 * so the age is *mathematically correct*, which is exactly the problem: a
 * correct age on a snapshot whose content was true in a previous process's
 * world looks like a fresh-but-slow response. It passes every freshness
 * check and it is wrong.
 *
 * In memory, that path does not exist. A restart empties the cache, so the
 * first read after a restart either succeeds or **fails loudly**. There is
 * no way to present a pre-restart snapshot as a post-restart one.
 *
 * AND NOTHING IS LOST. A snapshot is a projection of a system the station
 * does not own; if it is gone, the MES can produce it again. The durable
 * facts — the weighing record, the sync queue, the idempotency ledger —
 * live in other units and they are persisted.
 *
 * THE BOUND
 * ---------
 * One queue and a fixed number of recipes. An unbounded cache of every
 * recipe read over a shift would be a memory leak with no operational
 * purpose: the recipe's working copy belongs to unit `002`.
 */
import type { BatchQueueSnapshot } from '../entities/snapshots.js';
import type { RecipeSnapshot } from '../entities/snapshots.js';
import type { BatchId } from '../value-objects/identifiers.js';

/** How many recipes the cache holds. */
export const DEFAULT_RECIPE_CACHE_SIZE = 16;

/** The cache's key: the queue, or one batch's recipe. */
export type SnapshotKey =
  | { readonly kind: 'QUEUE' }
  | { readonly kind: 'RECIPE'; readonly batchId: BatchId };

export class SnapshotCache {
  private queue: BatchQueueSnapshot | null = null;

  /**
   * The cached recipes, in **least-recently-used first** order.
   *
   * A plain map would not do: JavaScript's `Map` preserves *insertion*
   * order, and re-reading a recipe must move it to the back or the cache
   * would evict the recipes that are actually being used.
   */
  private readonly recipes = new Map<string, RecipeSnapshot>();

  constructor(private readonly recipeCapacity: number = DEFAULT_RECIPE_CACHE_SIZE) {
    if (!Number.isInteger(recipeCapacity) || recipeCapacity < 1) {
      throw new Error('The recipe cache capacity must be a positive whole number');
    }
  }

  /** Remember the last known-good queue. */
  rememberQueue(snapshot: BatchQueueSnapshot): void {
    this.queue = snapshot;
  }

  /** The last known-good queue, or null if there has never been one. */
  recallQueue(): BatchQueueSnapshot | null {
    return this.queue;
  }

  /** Remember the last known-good recipe for a batch. */
  rememberRecipe(snapshot: RecipeSnapshot): void {
    const key = snapshot.batchId.value;

    // Re-remembering a recipe must refresh its recency, so it is deleted
    // first — a Map's `set` on an existing key keeps the ORIGINAL position.
    this.recipes.delete(key);
    this.recipes.set(key, snapshot);

    while (this.recipes.size > this.recipeCapacity) {
      // `Map` iterates in insertion order, so the first key is the least
      // recently used.
      const oldest = this.recipes.keys().next();
      if (oldest.done === true) break;
      this.recipes.delete(oldest.value);
    }
  }

  /** The last known-good recipe for a batch, or null. */
  recallRecipe(batchId: BatchId): RecipeSnapshot | null {
    const key = batchId.value;
    const found = this.recipes.get(key);
    if (found === undefined) return null;

    // Refresh recency on a hit, for the same reason as above.
    this.recipes.delete(key);
    this.recipes.set(key, found);
    return found;
  }

  /** How many recipes are currently held. */
  get recipeCount(): number {
    return this.recipes.size;
  }

  /**
   * Forget everything.
   *
   * Used when the link goes `OFFLINE` — an `OFFLINE` link must not serve a
   * last known-good, so the fallback has to be gone, not merely ignored.
   */
  clear(): void {
    this.queue = null;
    this.recipes.clear();
  }
}
