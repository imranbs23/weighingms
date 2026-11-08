/**
 * RecipeController — the station's recipe endpoint.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE VERB. ONE PATH. ONE RULE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `GET /api/recipe/:batchId` answers *"what must this station dispense for
 * this batch?"* — a different question from unit `005`'s *"what did the MES
 * say?"* (ADR-032).
 *
 * WHY `/api/recipe/:batchId` AND NOT `/api/batches/:batchId/recipe`
 * -----------------------------------------------------------
 * **`/api/batches/*` is the Dummy MES's prefix.** Its router is mounted at
 * `/api` and owns `/api/batches/:batchId/recipe`, so a route there would be
 * **silently captured** by the Dummy's own recipe route — a failure that
 * looks like a missing batch rather than a routing mistake.
 *
 * `/api/recipe` cannot collide: no router in this product owns a route that
 * begins with `/recipe`.
 *
 * THE SURFACE HAS EXACTLY ONE VERB
 * --------------------------------
 * The recipe is read-only (BRD BR-04, C-01). There is no `POST`, `PUT`,
 * `PATCH` or `DELETE` on this resource — not a "not yet implemented", but a
 * surface that does not exist. The read-only rule is **structural**: there
 * is no write path to protect, because there is no write path.
 *
 * THE FAILURE IS DISTINGUISHABLE, AND THAT IS THE POINT
 * -----------------------------------------------------
 * A recipe with no components and a recipe that could not be fetched both
 * produce nothing on screen. If the failure were silent, the operator could
 * not tell *"this batch has nothing to weigh"* from *"we cannot see what to
 * weigh"* — and would look for the wrong problem.
 *
 * So:
 *   - an **empty** recipe is a `200` with `components: []` and a counter of
 *     `0 of 0`;
 *   - an **unreachable** MES is a `503` whose body has **no `recipe` key at
 *     all** — not an empty recipe.
 *
 * A client that renders whatever is under `recipe` is therefore forced to
 * look at the status code to know it is in the error state. This is unit
 * `001`'s rule (ADR-028) and it is the same rule here.
 *
 * NO PROSE CROSSES THIS BOUNDARY
 * ------------------------------
 * The body carries **codes** and data, never a sentence (BRD NFR-11,
 * FR-22). The diagnostic goes to the log (BRD IR-09); the operator-facing
 * text is the UI's.
 */
import { Router, type Request, type Response } from 'express';
import type { RecipeMaterialModule } from '../../infrastructure/composition-root.js';
import type { Recipe } from '../../domain/entities/recipe.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';

export const RECIPE_UNAVAILABLE = 'RECIPE_UNAVAILABLE';
export const RECIPE_REJECTED = 'RECIPE_REJECTED';
export const BATCH_NOT_FOUND = 'BATCH_NOT_FOUND';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export function createRecipeRouter(recipes: RecipeMaterialModule): Router {
  const router = Router();

  /**
   * GET /api/recipe/:batchId — the recipe the station must dispense.
   *
   * 200 — the recipe, with its counter, its receipt time and its freshness.
   * 400 — the batch id is empty or malformed.
   * 401 — no operator session.
   * 404 — the MES was REACHED and has no such batch.
   * 503 — the MES could not be reached, or its answer was unusable.
   *
   * ADR-020: the endpoint requires an operator session. The recipe is
   * OrgaTEX's production data, not a physically visible device state, so
   * ADR-013's exemption does not apply. A supervisor is NOT required:
   * reading authorises nothing.
   */
  router.get('/:batchId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const raw = req.params['batchId'];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await recipes.loadRecipe.execute(raw);

    switch (outcome.kind) {
      case 'LOADED':
        res.status(200).json({ recipe: serialiseRecipe(outcome.recipe) });
        return;

      case 'NOT_FOUND':
        // The MES was REACHED and said no. A `404`, not a `503`.
        res.status(404).json({ error: BATCH_NOT_FOUND });
        return;

      case 'UNAVAILABLE':
        // The reason code and nothing else. The diagnostic went to the log
        // (BRD IR-09).
        //
        // NO `recipe` KEY — so this can never be mistaken for an empty
        // recipe.
        res.status(503).json({
          error: RECIPE_UNAVAILABLE,
          reason: outcome.reason,
        });
        return;

      case 'REJECTED':
        // The MES was reached and its answer was unusable. A different
        // code from an unreachable MES — they are different facts.
        res.status(503).json({
          error: RECIPE_REJECTED,
          reason: outcome.reason,
        });
        return;
    }
  });

  return router;
}

/**
 * Serialise a recipe for the wire.
 *
 * Every quantity is a **string** — never a JSON number (ADR-008, BRD
 * NFR-16). Every absent fact is `null` — never a zero and never a
 * fabricated value. And the freshness is always present, so a consumer can
 * never have to infer staleness from its absence.
 */
function serialiseRecipe(recipe: Recipe): unknown {
  return {
    batchId: recipe.batchId.value,
    shadeCode: recipe.shadeCode.value,
    components: recipe.components.map((component) => ({
      sequence: component.sequence,
      componentId: component.componentId.value,
      dyestuffCode: component.dyestuffCode.value,
      // `null` when the MES supplied no name. Never a fabricated one.
      name: component.name === null ? null : component.name.value,
      // `null` when the MES supplied no colour. Never a default one.
      swatchColour:
        component.swatchColour === null ? null : component.swatchColour.value,
      // The target as a decimal string — never a JSON number.
      target: component.target.toJSON(),
      unit: component.target.unit,
      // `null` when the MES expressed no band. Never a band of zero.
      tolerance:
        component.tolerance === null
          ? null
          : {
              min: component.tolerance.min.toJSON(),
              max: component.tolerance.max.toJSON(),
            },
      // `null` when the MES supplied no class. The unit does not guess a
      // scale.
      scaleClass: component.scaleClass,
      state: component.state,
    })),
    // Derived from the component states — never a stored number that could
    // disagree with the list it counts.
    counter: recipe.counter.toJSON(),
    // The receipt time — unit 005's fact, carried through unchanged.
    receivedAt: recipe.receivedAt.toString(),
    source: recipe.source,
    // Unit 005's freshness decision, carried through unchanged. This unit
    // does not re-decide staleness (ADR-031).
    freshness: serialiseFreshness(recipe.freshness),
  };
}

/**
 * Serialise the freshness marker.
 *
 * It is **always present** — a consumer must never have to infer whether a
 * recipe is stale from its absence. A `STALE` freshness **always** carries
 * its age, so the projection cannot report zero for an unknown age.
 */
function serialiseFreshness(freshness: SnapshotFreshness): unknown {
  if (freshness.kind === 'CURRENT') {
    return { kind: 'CURRENT' };
  }
  return { kind: 'STALE', ageMs: freshness.ageMs };
}
