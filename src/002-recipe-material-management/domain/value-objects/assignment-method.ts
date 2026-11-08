/**
 * AssignmentMethod — how the container was identified.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET OF TWO, DERIVED FROM THE REQUEST'S SHAPE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story: *"where a container is identified by a scan, the container ID
 * may arrive by scan or by keyed entry, and both routes record the same
 * assignment with the method captured."*
 *
 * So the method is captured — and it is **derived**, never supplied
 * (ADR-030, ADR-035). A `code` in the body came from the scanner; a
 * `containerId` was typed in. There is no field a client could set, so a
 * client cannot record a scan that never happened.
 *
 * - `SCAN` — the operator presented the container's code to the scanner.
 * - `KEYED_IN` — the operator typed the container's id.
 */
export type AssignmentMethod = 'SCAN' | 'KEYED_IN';

export const ASSIGNMENT_METHODS: readonly AssignmentMethod[] = [
  'SCAN',
  'KEYED_IN',
];

/**
 * Is this an assignment method?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint.
 */
export function isAssignmentMethod(value: unknown): value is AssignmentMethod {
  return (
    typeof value === 'string' &&
    (ASSIGNMENT_METHODS as readonly string[]).includes(value)
  );
}
