/**
 * BatchWeighingStatus — the MES's own record of where a batch is.
 *
 * The MES OWNS this field. WeighingMS reads it, and writes it only in bolt
 * `006` (BRD IR-06) — and then only the status field itself, never any
 * other batch field (BRD §9.2).
 *
 * A CLOSED SET, so the status is **data** rather than prose assembled at the
 * call site. The five members are the BRD's own (BRD §9.2, BATCH entity:
 * `QUEUED RELEASED WEIGHING WEIGHED CANCELLED`).
 */
export type BatchWeighingStatus =
  | 'QUEUED'
  | 'RELEASED'
  | 'WEIGHING'
  | 'WEIGHED'
  | 'CANCELLED';

export const BATCH_WEIGHING_STATUSES: readonly BatchWeighingStatus[] = [
  'QUEUED',
  'RELEASED',
  'WEIGHING',
  'WEIGHED',
  'CANCELLED',
];

/**
 * Is this a weighing status the seam understands?
 *
 * An unknown status is REFUSED rather than mapped to a default. The
 * eligibility rule's whole job is to say whether a batch may be selected,
 * and mapping an unknown status onto `NOT_RELEASED` would be a guess that
 * happens to be the safe direction — but it would still be a guess about
 * the MES's vocabulary, made silently.
 */
export function isBatchWeighingStatus(
  value: unknown,
): value is BatchWeighingStatus {
  return (
    typeof value === 'string' &&
    (BATCH_WEIGHING_STATUSES as readonly string[]).includes(value)
  );
}
