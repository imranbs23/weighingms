/**
 * RecipeSource — the port through which unit 002 reads the MES.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PORT BELONGS TO THE CONSUMER. THAT IS THE WHOLE DECISION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `005` owns the port to the **external system** (`OrgatexAdapter`).
 * This unit owns the port to **unit `005`** — because a port belongs to the
 * unit that depends on it (ADR-028, applied to the recipe by ADR-032).
 *
 * What that buys:
 *
 * - the dependency runs **inward**, from the application layer to a port
 *   this unit owns;
 * - unit `002` never imports unit `005`'s reader *class*, so unit `005`'s
 *   next refactor cannot ripple into a unit with no reason to know about it;
 * - there is exactly **one** reader of the MES seam, so there is one contact
 *   per read, one cache and one source of truth;
 * - the read is **in process** — the station's own API never calls its own
 *   API over a socket;
 * - a test can bind a **controlled source** that returns a specific
 *   failure, with no MES, no database and no network.
 *
 * THE OUTCOME IS A UNION, NOT A THROWN ERROR
 * ------------------------------------------
 * An unreachable MES is a **normal condition** of this product — FR-20
 * requires the station to keep working through one — so it is modelled as an
 * outcome rather than an exception. A caller that forgot to handle it would
 * turn a recoverable outage into an outage with a crash on top.
 *
 * `NOT_FOUND` is its own kind, because it is **not a failure**: the MES was
 * reached and said there is no such batch, which is a `404` and not a `503`.
 * The rule is *a 404 may only come from a successful contact*.
 */
import type { RecipeReadOutcome } from '../../../005-orgatex-integration/domain/services/recipe-reader.js';
import type { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export interface RecipeSource {
  /**
   * Read a batch's recipe.
   *
   * The id is a `BatchId` — unit `005`'s bounded, trimmed identifier — so
   * the port's shape says that a batch id is a *parsed, bounded* thing and
   * not a raw string from a path.
   *
   * @returns The reader's outcome. A failure is **returned**, not thrown.
   */
  read(batchId: BatchId): Promise<RecipeReadOutcome>;
}

/**
 * The outcome's kinds, re-exported so a consumer of this port does not have
 * to import unit `005`'s reader module to name them.
 */
export type { RecipeReadOutcome };
