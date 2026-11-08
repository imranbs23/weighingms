/**
 * RecipeProjector — the snapshot becomes the station's recipe.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PURE FUNCTION OF THE SNAPSHOT. IT CONTACTS NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The projector is where the seam's answer is **interpreted**. It is pure:
 * no clock, no network, no cache, no freshness decision. The freshness
 * arrives in the snapshot and is carried through **unchanged** — this unit
 * does not re-decide staleness, because the threshold that decides it is
 * unit `005`'s configuration (ADR-028's rule, applied to the recipe by
 * ADR-032).
 *
 * WHAT IT CHECKS, AND WHY EACH CHECK FAILS THE WHOLE RECIPE
 * -----------------------------------------------------------
 * A recipe with one malformed component fails the **whole** read. A
 * partially valid recipe is a wrong target on the scale: the operator would
 * weigh against a target the MES never gave (S-24).
 *
 * 1. **The decimal-place bound.** Every quantity is at most **four**
 *    decimal places (BRD §9.2 `decimal(12,4)`). A target with five is
 *    **refused**, not truncated — the story is explicit: *"the adapter layer
 *    rejects the payload as invalid rather than silently truncating
 *    precision."*
 * 2. **The sequence is unique.** Two components at the same position have
 *    no defined order between them.
 * 3. **The colour is a colour token.** The prototype concatenates the
 *    colour into a CSS `background` declaration, so an arbitrary string
 *    from the MES would be a style-injection vector (ADR-032).
 * 4. **The display facts are optional.** A missing name or swatch is
 *    `null` — never a fabricated one.
 *
 * EVERY COMPONENT STARTS `PENDING`
 * --------------------------------
 * The state is this unit's session model, and the **progression** — which
 * component becomes active, when one is done — belongs to unit `003`. So a
 * load sets every component to `PENDING` and nothing more.
 */
import { Recipe } from '../entities/recipe.js';
import { RecipeComponent } from '../entities/recipe-component.js';
import type { RecipeSnapshot } from '../../../005-orgatex-integration/domain/entities/snapshots.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { MaterialName } from '../value-objects/material-name.js';
import { SwatchColour } from '../value-objects/swatch-colour.js';

/**
 * The most decimal places a quantity may carry.
 *
 * BRD §9.2 stores `target_qty` and the tolerance bounds as `decimal(12,4)`.
 * Four places is the bound the MES's own schema imposes, so a fifth place
 * is a payload the MES should not have sent.
 */
export const MAX_QUANTITY_DECIMAL_PLACES = 4;

export class RecipeProjector {
  /**
   * Turn a snapshot into the station's recipe.
   *
   * @throws When the snapshot violates an invariant — a duplicate sequence,
   *         a quantity with too many decimal places, or a colour that is
   *         not a colour token.
   */
  project(snapshot: RecipeSnapshot, freshness: SnapshotFreshness): Recipe {
    const components = [...snapshot.components]
      .sort((left, right) => left.sequence - right.sequence)
      .map((component) => this.projectComponent(component));

    return new Recipe(
      snapshot.batchId,
      snapshot.shadeCode,
      components,
      snapshot.receivedAt,
      snapshot.source,
      freshness,
    );
  }

  private projectComponent(
    component: RecipeSnapshot['components'][number],
  ): RecipeComponent {
    assertDecimalPlaces(component.target.text, component.componentId.value, 'target');

    if (component.tolerance !== null) {
      assertDecimalPlaces(
        component.tolerance.min.text,
        component.componentId.value,
        'tolerance.min',
      );
      assertDecimalPlaces(
        component.tolerance.max.text,
        component.componentId.value,
        'tolerance.max',
      );
    }

    return new RecipeComponent(
      component.sequence,
      component.componentId,
      component.dyestuffCode,
      component.target,
      component.tolerance,
      component.scaleClass,
      projectName(component.name, component.componentId.value),
      projectSwatch(component.swatchColour, component.componentId.value),
      'PENDING',
    );
  }
}

/**
 * The material's name, or `null`.
 *
 * A missing name is `null`. A name that is present but unusable — too long,
 * or empty — is a **refusal**, not a silent `null`: the MES supplied
 * something, and quietly discarding it would hide a bad payload.
 */
function projectName(raw: string | null, componentId: string): MaterialName | null {
  if (raw === null) return null;
  try {
    return MaterialName.of(raw);
  } catch (error) {
    throw new Error(
      `Component ${componentId} has an unusable name: ${(error as Error).message}`,
    );
  }
}

/**
 * The material's colour, or `null`.
 *
 * A missing colour is `null`. A colour that is present but is not a colour
 * token is a **refusal** — the same reasoning as the name. The colour ends
 * up inside a CSS declaration, so an unusable one is a payload the station
 * must not carry (ADR-032).
 */
function projectSwatch(
  raw: string | null,
  componentId: string,
): SwatchColour | null {
  if (raw === null) return null;
  try {
    return SwatchColour.of(raw);
  } catch (error) {
    throw new Error(
      `Component ${componentId} has an unusable swatch colour: ${(error as Error).message}`,
    );
  }
}

/**
 * Refuse a quantity with more decimal places than the MES's schema allows.
 *
 * **Not truncated.** The story is explicit: *"the adapter layer rejects the
 * payload as invalid rather than silently truncating precision."* A
 * truncated quantity is a quantity the MES never gave, and the operator
 * would weigh against it.
 */
function assertDecimalPlaces(
  text: string,
  componentId: string,
  field: string,
): void {
  const dot = text.indexOf('.');
  if (dot === -1) return;
  const places = text.length - dot - 1;
  if (places > MAX_QUANTITY_DECIMAL_PLACES) {
    throw new Error(
      `Component ${componentId} has a ${field} with ${places} decimal places; at most ${MAX_QUANTITY_DECIMAL_PLACES} are allowed`,
    );
  }
}
