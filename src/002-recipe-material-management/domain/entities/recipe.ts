/**
 * Recipe — the aggregate. The station's working copy of a batch's recipe.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS NOT UNIT 005's `RecipeSnapshot`, AND THE DIFFERENCE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `005`'s snapshot is a **point-in-time copy of somebody else's truth**,
 * taken through a read-only seam. It has no invariants to enforce and no
 * lifecycle to protect, so it is deliberately *not* an aggregate.
 *
 * This one is the station's **working copy** — the recipe the session is
 * working, with the component states on it. It has invariants (the sequence
 * is unique, the counter agrees with the list) and a lifecycle (it is
 * loaded, and it is replaced by the next load), so it **is** an aggregate.
 *
 * The two are different objects with different owners:
 *
 * | | Owner | What it is |
 * |---|---|---|
 * | The **last-known-good** | unit `005` | A **fallback** copy, served only when the contact failed, always **with its age**. |
 * | The **working copy** | unit `002` | The station's **working set**. |
 *
 * Neither is a copy of the other's answer, and neither re-decides the other's
 * staleness (ADR-031).
 *
 * THE INVARIANTS, AND WHERE THEY ARE ENFORCED
 * --------------------------------------------
 * 1. **Read-only against the MES.** No mutator exists for a target, a
 *    tolerance, a code, a sequence, a class, a name or a colour.
 * 2. **The sequence is unique.** Two components may not share a weighing
 *    order — the order is what the operator weighs in, and two slots at the
 *    same position have no defined order between them.
 * 3. **The counter agrees with the list.** It is **derived**, never stored
 *    independently.
 * 4. **The components are in recipe sequence.** The list is ordered by the
 *    sequence, so the order the MES gave and the order the operator weighs
 *    in cannot drift apart.
 *
 * AND THE STATION'S COPY IS NOT PERSISTED
 * ----------------------------------------
 * A persisted recipe is a *stale-looking-fresh* risk: a row written before a
 * power cut and read back afterwards carries a pre-restart `receivedAt`, and
 * its age is *mathematically correct* — which is exactly the problem. It
 * passes every freshness check and it is wrong (ADR-031).
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { ShadeCode } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { RecipeCounter } from '../value-objects/recipe-counter.js';
import type { RecipeComponent } from './recipe-component.js';

export class Recipe {
  /**
   * @param components The components, **in recipe sequence**. The caller
   *   orders them — the projector does, and it is the projector that checks
   *   the sequence is unique.
   */
  constructor(
    readonly batchId: BatchId,
    readonly shadeCode: ShadeCode,
    readonly components: readonly RecipeComponent[],
    /** When the recipe was received — the MES's receipt time, unchanged. */
    readonly receivedAt: Instant,
    /** Which adapter produced it. */
    readonly source: string,
    /** Unit `005`'s freshness decision, **passed through unchanged**. */
    readonly freshness: SnapshotFreshness,
  ) {
    const seen = new Set<number>();
    for (const component of components) {
      if (seen.has(component.sequence)) {
        throw new Error(
          `Two components of recipe ${batchId.value} share the sequence ${component.sequence}`,
        );
      }
      seen.add(component.sequence);
    }
  }

  /** How many components the MES said the recipe has. */
  get count(): number {
    return this.components.length;
  }

  /**
   * The counter — **derived** from the component states.
   *
   * Computed on demand, never stored: a stored counter could disagree with
   * the list it counts, and that disagreement is invisible to the operator.
   */
  get counter(): RecipeCounter {
    return RecipeCounter.of(this.components);
  }

  /**
   * The component with this id, or `null`.
   *
   * The comparison is exact — `ComponentId` is a bounded, trimmed
   * identifier, and two ids that differ only in case are two different
   * components. No case folding: a component id is not a natural-language
   * name, and folding it would make two real components one.
   */
  componentById(componentId: string): RecipeComponent | null {
    const wanted = componentId.trim();
    for (const component of this.components) {
      if (component.componentId.value === wanted) return component;
    }
    return null;
  }
}
