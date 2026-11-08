/**
 * RecipeWorkingCopy — the station's working set. One recipe.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE COPY, NOT A MAP.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The station weighs **one batch at a time** (A-11 — one station, one site
 * in V1). A map keyed by batch id would be an unbounded working set with no
 * eviction policy and no operator — a memory leak with an operational
 * purpose attached to it.
 *
 * And the story settles the rest: *"the already-loaded recipe for the active
 * session is unchanged"* — so the copy is replaced by an **explicit load**,
 * never by a background re-read. There is no timer here, and there is no
 * path that re-reads the MES behind the operator's back.
 *
 * WHY IT IS IN MEMORY, AND NOT PERSISTED
 * --------------------------------------
 * A persisted recipe is a *stale-looking-fresh* risk: a row written before a
 * power cut and read back afterwards carries a pre-restart `receivedAt`,
 * and its age is *mathematically correct* — which is exactly the problem. It
 * passes every freshness check and it is wrong (ADR-031).
 *
 * In memory that path does not exist. A restart empties the copy, so the
 * first read either succeeds or **fails loudly**. And the outage case is
 * served by unit `005`'s last-known-good, which is served **with its age**
 * (ADR-021).
 */
import type { Recipe } from '../entities/recipe.js';

export class RecipeWorkingCopy {
  private recipe: Recipe | null = null;

  /** The recipe the station is working, or `null` if none has been loaded. */
  current(): Recipe | null {
    return this.recipe;
  }

  /**
   * Replace the working copy.
   *
   * The replacement is the **whole** recipe — there is no partial update,
   * because a partially updated recipe is a recipe whose components and
   * counter disagree.
   */
  replace(recipe: Recipe): void {
    this.recipe = recipe;
  }

  /** Forget the working copy. */
  clear(): void {
    this.recipe = null;
  }

  /** Is a recipe loaded? */
  get isLoaded(): boolean {
    return this.recipe !== null;
  }
}
