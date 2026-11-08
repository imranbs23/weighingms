/**
 * MaterialName — the material's display name.
 *
 * ══════════════════════════════════════════════════════════════════════
 * BOUNDED, BECAUSE IT TRAVELS INTO A PAYLOAD AND A LOG LINE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The name arrives from an external system and is shown to an operator and
 * written to logs. An unbounded string is an unbounded thing to carry in
 * both, so it is bounded here — at 200 characters, which is well past any
 * real material name and well short of anything that could push a log line
 * around.
 *
 * AND IT IS OPTIONAL
 * ------------------
 * The BRD puts `name` on the **DYESTUFF master** (BRD §9.2), and whether the
 * MES's recipe payload carries it is **A-01's unanswered question**
 * (ADR-032). So a component may have **no** name, and that is `null` —
 * never an empty string, and never a fabricated one.
 *
 * The story is explicit: *"no component, target quantity or swatch colour
 * is hard-coded in the UI."* A missing name is a missing label, and a label
 * has a correct fallback — unlike a missing *target*, which does not.
 */

/** The longest name that may cross the boundary. */
export const MAX_MATERIAL_NAME_LENGTH = 200;

export class MaterialName {
  private constructor(readonly value: string) {}

  /**
   * Build a name from the MES's text.
   *
   * @throws When the name is empty or longer than the bound.
   */
  static of(raw: string): MaterialName {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error('A material name must not be empty');
    }
    if (trimmed.length > MAX_MATERIAL_NAME_LENGTH) {
      throw new Error(
        `A material name must not exceed ${MAX_MATERIAL_NAME_LENGTH} characters`,
      );
    }
    return new MaterialName(trimmed);
  }

  equals(other: MaterialName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
