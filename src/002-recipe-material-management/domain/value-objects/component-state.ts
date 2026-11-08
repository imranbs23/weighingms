/**
 * ComponentState — where a component is in the weighing.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET OF THREE, AND THE CLOSURE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The prototype's rail has three states — `done`, `WEIGHING` and `PENDING`
 * — and the requirement says so: *"Components are presented in recipe
 * sequence with completed, active and pending states"* (BRD FR-06).
 *
 * So the set is exactly those three. A fourth would be a state somebody
 * invented, and the rail would have to render it — and every extra state is
 * a state the operator cannot act on.
 *
 * `DONE` IS THE ONLY STATE THAT COUNTS
 * ------------------------------------
 * The counter is *"the number of components weighed so far against the
 * total number of components in the recipe"*. Only a `DONE` component has
 * been weighed, so only `DONE` counts. A component that is `ACTIVE` is
 * *being* weighed and has not been weighed.
 *
 * AND `ACTIVE` IS UNIT 003's TO GIVE
 * ----------------------------------
 * This bolt sets every component to `PENDING` at load. **Which** component
 * becomes active is unit `003`'s progression rule, and this bolt does not
 * decide it. The state is modelled here because the rail renders it, and
 * the progression belongs to the unit that owns the weighing.
 */
export type ComponentState = 'PENDING' | 'ACTIVE' | 'DONE';

export const COMPONENT_STATES: readonly ComponentState[] = [
  'PENDING',
  'ACTIVE',
  'DONE',
];

/**
 * Is this a component state?
 *
 * The seam's vocabulary is not ours (A-01), so a value that is not one of
 * the three is refused rather than coerced.
 */
export function isComponentState(value: unknown): value is ComponentState {
  return (
    typeof value === 'string' &&
    (COMPONENT_STATES as readonly string[]).includes(value)
  );
}
