/**
 * LoadRecipe — the one use case this bolt has.
 *
 * ══════════════════════════════════════════════════════════════════════
 * READ THROUGH THE SEAM, PROJECT, AND HOLD THE WORKING COPY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The read is **in process** through unit `005`'s reader, over a port this
 * unit owns (`RecipeSource`). There is no HTTP hop, no second reader and no
 * second cache — the one-reader rule (ADR-028) and the one-contact rule
 * (ADR-032).
 *
 * THE OUTCOME IS A UNION
 * ----------------------
 * Four kinds, and each maps to exactly one HTTP status:
 *
 * | Outcome | Meaning | HTTP |
 * |---|---|---|
 * | `LOADED` | The recipe is the working copy | `200` |
 * | `NOT_FOUND` | The MES was **reached** and has no such batch | `404` |
 * | `UNAVAILABLE` | The MES could not be reached | `503` |
 * | `REJECTED` | The MES's answer was unusable | `503` |
 *
 * `NOT_FOUND` is **not** a failure of the link — it is a successful contact
 * with a negative answer, and the rule is *a 404 may only come from a
 * successful contact*.
 *
 * `REJECTED` is separate from `UNAVAILABLE` because they are different
 * facts: one is *"we could not reach it"* and the other is *"we reached it
 * and its answer was not usable"*. A malformed recipe fails the **whole**
 * read — a partially valid recipe is a wrong target on the scale (S-24).
 *
 * AND THE FRESHNESS IS PASSED THROUGH, NOT RE-DERIVED
 * ---------------------------------------------------
 * The freshness window is unit `005`'s configuration (BRD NFR-14), and unit
 * `005`'s reader is the thing that decides whether a snapshot is `CURRENT`
 * or `STALE`. This use case carries the decision **unchanged** — it does
 * not re-decide staleness and it does not hide it either (ADR-031).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { Recipe } from '../../domain/entities/recipe.js';
import type { RecipeSource } from '../../domain/ports/recipe-source.js';
import { RecipeProjector } from '../../domain/services/recipe-projector.js';
import { RecipeWorkingCopy } from '../../domain/services/recipe-working-copy.js';
import type { RecipeEvent } from '../../domain/events/recipe-events.js';

/** The outcome of a recipe load. */
export type LoadRecipeOutcome =
  | {
      readonly kind: 'LOADED';
      readonly recipe: Recipe;
    }
  | {
      /** The MES was reached and has no such batch. A `404`, not a `503`. */
      readonly kind: 'NOT_FOUND';
      readonly message: string;
    }
  | {
      /** The MES could not be reached. A `503`. */
      readonly kind: 'UNAVAILABLE';
      readonly reason: 'UNREACHABLE' | 'TIMEOUT';
      readonly message: string;
    }
  | {
      /** The MES was reached and its answer was unusable. A `503`. */
      readonly kind: 'REJECTED';
      readonly reason: 'MALFORMED';
      readonly message: string;
    };

export interface LoadRecipeOptions {
  /** The seam the recipe is read through. */
  readonly source: RecipeSource;
  /** The projector — how the snapshot becomes the station's recipe. */
  readonly projector: RecipeProjector;
  /** The working copy the loaded recipe is held in. */
  readonly workingCopy: RecipeWorkingCopy;
  /** The clock — the failure event is timestamped. */
  readonly clock: () => Date;
  /**
   * Where a failure's diagnostic goes.
   *
   * The **detail** never reaches the client (BRD IR-09); the client is
   * told the reason code and nothing else.
   */
  readonly onError?: (detail: string) => void;
  /** Where the domain events go. */
  readonly onEvent?: (event: RecipeEvent) => void;
}

export class LoadRecipe {
  constructor(private readonly options: LoadRecipeOptions) {}

  /**
   * Load a batch's recipe, and make it the working copy.
   *
   * @param batchId The batch to load. Parsed here, so a malformed id is a
   *   refusal rather than a crash.
   */
  async execute(batchId: string): Promise<LoadRecipeOutcome> {
    let id: BatchId;
    try {
      id = BatchId.create(batchId);
    } catch {
      this.options.onError?.(
        `[recipe] the batch id "${batchId}" is not a valid identifier`,
      );
      return {
        kind: 'REJECTED',
        reason: 'MALFORMED',
        message: 'The batch id is not a valid identifier',
      };
    }

    const outcome = await this.options.source.read(id);

    if (outcome.kind === 'NOT_FOUND') {
      this.options.onError?.(
        `[recipe] the MES has no recipe for batch ${id.value}: ${outcome.message}`,
      );
      this.emit({
        kind: 'RECIPE_LOAD_FAILED',
        batchId: id,
        reason: 'NOT_FOUND',
        at: Instant.of(this.options.clock()),
      });
      return { kind: 'NOT_FOUND', message: outcome.message };
    }

    if (outcome.kind === 'FAILED') {
      this.options.onError?.(
        `[recipe] the recipe for batch ${id.value} is unavailable (${outcome.reason}): ${outcome.message}`,
      );
      this.emit({
        kind: 'RECIPE_LOAD_FAILED',
        batchId: id,
        reason: outcome.reason,
        at: Instant.of(this.options.clock()),
      });

      // `UNREACHABLE` and `TIMEOUT` are a link problem; `MALFORMED` is an
      // unusable answer. They are different facts and they are reported as
      // different outcomes.
      if (outcome.reason === 'MALFORMED') {
        return {
          kind: 'REJECTED',
          reason: 'MALFORMED',
          message: outcome.message,
        };
      }
      return {
        kind: 'UNAVAILABLE',
        reason: outcome.reason,
        message: outcome.message,
      };
    }

    // SUCCEEDED or SUCCEEDED_STALE — the freshness is carried through
    // **unchanged**. The station does not re-decide staleness.
    let recipe: Recipe;
    try {
      recipe = this.options.projector.project(outcome.snapshot, outcome.freshness);
    } catch (error) {
      // The MES's answer was unusable. The whole read fails — a partially
      // valid recipe is a wrong target on the scale.
      const detail = (error as Error).message;
      this.options.onError?.(
        `[recipe] the recipe for batch ${id.value} was rejected: ${detail}`,
      );
      this.emit({
        kind: 'RECIPE_LOAD_FAILED',
        batchId: id,
        reason: 'MALFORMED',
        at: Instant.of(this.options.clock()),
      });
      return { kind: 'REJECTED', reason: 'MALFORMED', message: detail };
    }

    this.options.workingCopy.replace(recipe);

    this.emit({
      kind: 'RECIPE_LOADED',
      batchId: recipe.batchId,
      shadeCode: recipe.shadeCode.value,
      componentCount: recipe.count,
      receivedAt: recipe.receivedAt,
      source: recipe.source,
      freshnessKind: recipe.freshness.kind,
    });

    return { kind: 'LOADED', recipe };
  }

  /** The working copy — the recipe the station is working, or `null`. */
  current(): Recipe | null {
    return this.options.workingCopy.current();
  }

  private emit(event: RecipeEvent): void {
    this.options.onEvent?.(event);
  }
}
