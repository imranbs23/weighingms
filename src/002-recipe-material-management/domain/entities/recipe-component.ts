/**
 * RecipeComponent — one material the operator must dispense.
 *
 * ══════════════════════════════════════════════════════════════════════
 * READ-ONLY AGAINST THE MES. THERE IS NO WAY TO EDIT ONE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD BR-04 and C-01: the recipe is owned by OrgaTEX and is never authored
 * or modified locally. So this class exposes **no mutator** for a target, a
 * tolerance, a code, a sequence, a class, a name or a colour. There is no
 * `withTarget`, no `setTolerance`, no `rename`.
 *
 * The one thing that changes is the **state** — `PENDING` → `ACTIVE` →
 * `DONE` — and that is unit `003`'s progression rule acting on this unit's
 * session model. The state is a separate concern from the MES's facts, and
 * keeping it separate is what makes the read-only rule structural rather
 * than a convention.
 *
 * THE NULLABLE FIELDS MEAN ABSENT, NEVER ZERO AND NEVER UNKNOWN
 * -------------------------------------------------------------
 *   - `tolerance` absent = the MES expressed no band. **Not** a band of
 *     zero — a component with no tolerance is a component that cannot be
 *     confirmed.
 *   - `scaleClass` absent = the MES supplied no class. The unit **does not
 *     guess a scale**: the story is explicit that the component cannot
 *     proceed to dispensing until the value is supplied.
 *   - `name` / `swatchColour` absent = the MES supplied no display facts.
 *     They are **optional** because the BRD puts them on the DYESTUFF master
 *     and whether the recipe payload carries them is A-01's unanswered
 *     question (ADR-032).
 *
 * EVERY QUANTITY IS A FIXED-POINT DECIMAL
 * ----------------------------------------
 * `target` is a `WeightValue`, whose constructor accepts a **string** and
 * nothing else — so a `number` is a type error and BRD NFR-16 is enforced
 * by the type (ADR-008). The `tolerance` is unit `005`'s `Tolerance`: a
 * **band**, not a deviation, with inclusive bounds.
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import type { DemandedScaleClass } from '../../../005-orgatex-integration/domain/value-objects/demanded-scale-class.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { DyestuffCode } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { ComponentState } from '../value-objects/component-state.js';
import type { MaterialName } from '../value-objects/material-name.js';
import type { SwatchColour } from '../value-objects/swatch-colour.js';

export class RecipeComponent {
  constructor(
    /** The weighing order. Unique within the recipe. */
    readonly sequence: number,
    /** This **slot** in this recipe — not the material. */
    readonly componentId: ComponentId,
    /** What the material **is** — the FCI article code. */
    readonly dyestuffCode: DyestuffCode,
    /** The quantity the MES says to dispense, with its unit. */
    readonly target: WeightValue,
    /** The MES's band, or `null` when the MES expressed none. */
    readonly tolerance: Tolerance | null,    /** What the component demands of a scale, or `null` when the MES gave none. */
    readonly scaleClass: DemandedScaleClass | null,
    /** The material's display name, or `null` when the MES gave none. */
    readonly name: MaterialName | null,
    /** The material's colour, or `null` when the MES gave none. */
    readonly swatchColour: SwatchColour | null,
    /** Where the component is in the weighing. */
    readonly state: ComponentState,
  ) {}

  /**
   * Can this component be dispensed?
   *
   * Two things block it, and both are the MES's facts rather than the
   * operator's:
   *
   * 1. **No scale class.** The unit does not guess a scale — the story is
   *    explicit that the component cannot proceed until the value is
   *    supplied.
   * 2. **No tolerance.** A component with no band cannot be judged
   *    in-tolerance, and a missing band is never a band of zero.
   */
  get canProceed(): boolean {
    return this.scaleClass !== null && this.tolerance !== null;
  }
}
