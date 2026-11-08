/**
 * ContainerType — what kind of vessel this is.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET OF THREE, STRAIGHT FROM THE BRD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD §9.2's `CONTAINER` entity: *"type: enum — DRUM, BUCKET, BAG"*.
 *
 * It is a **property of the vessel**, and it is the one fact about a
 * container that is certainly known — a container is a drum, a bucket or a
 * bag, and that does not change while it is in service. It is copied onto
 * the assignment so the record stays meaningful even if the master changes.
 */
export type ContainerType = 'DRUM' | 'BUCKET' | 'BAG';

export const CONTAINER_TYPES: readonly ContainerType[] = [
  'DRUM',
  'BUCKET',
  'BAG',
];

/**
 * Is this a container type?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint, so
 * a value outside it cannot be written even by a path that bypasses the
 * domain. This guard is how a row is read **back** through the domain.
 */
export function isContainerType(value: unknown): value is ContainerType {
  return (
    typeof value === 'string' &&
    (CONTAINER_TYPES as readonly string[]).includes(value)
  );
}
