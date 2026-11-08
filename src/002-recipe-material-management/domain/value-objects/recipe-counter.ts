/**
 * RecipeCounter — the components weighed so far, against the total.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DERIVED, NEVER STORED INDEPENDENTLY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The requirement is *"a count of components weighed so far is displayed
 * against the total number of components in the recipe"*. Two numbers, and
 * they are both **facts about the component list**.
 *
 * A counter that could disagree with the list it counts would be a **second
 * source of truth** for the list — and a disagreement here is the one thing
 * the operator cannot detect. "3 of 5" when two are done is a rail that
 * tells the operator the batch is further along than it is.
 *
 * So the counter is a **projection of the states**: `total` is the number of
 * components, and `weighed` is the number of `DONE` ones. It is computed
 * from the list every time it is asked for, so it cannot drift.
 */
export class RecipeCounter {
  private constructor(
    readonly weighed: number,
    readonly total: number,
  ) {}

  /**
   * Count a list of component states.
   *
   * @param states The state of every component, in recipe sequence.
   */
  static of(states: readonly { readonly state: string }[]): RecipeCounter {
    let weighed = 0;
    for (const component of states) {
      if (component.state === 'DONE') weighed += 1;
    }
    return new RecipeCounter(weighed, states.length);
  }

  /** Has every component been weighed? */
  get isComplete(): boolean {
    return this.total > 0 && this.weighed === this.total;
  }

  /** The "N of M" phrase's parts, for a client that renders its own text. */
  toJSON(): { weighed: number; total: number } {
    return { weighed: this.weighed, total: this.total };
  }
}
