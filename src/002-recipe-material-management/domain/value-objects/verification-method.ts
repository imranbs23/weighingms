/**
 * VerificationMethod — how the material's identity was established.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET OF TWO, AND THE CLOSURE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The traceability distinction is B-6: an **attested** weighing must be
 * distinguishable from a **scanned** one in the audit trail. If the method
 * were a free string, or if a third value were allowed, then "how do we
 * know" would have no answer — and the record would say nothing about how
 * the material was actually verified.
 *
 * So the set is exactly the two the story names:
 *
 * - `SCAN` — the operator presented the material's code to the scanner and
 *   it **matched** the component's dyestuff code.
 * - `ATTESTATION` — the operator confirmed the identity on screen.
 *
 * **AND THE METHOD IS NEVER SUPPLIED BY A CLIENT.** It is derived from the
 * request's shape (ADR-030, ADR-034): a `code` in the body means the
 * scanner read it, and an `attestation` in the body means the operator
 * confirmed it. There is no field a client could set.
 */
export type VerificationMethod = 'SCAN' | 'ATTESTATION';

export const VERIFICATION_METHODS: readonly VerificationMethod[] = [
  'SCAN',
  'ATTESTATION',
];

/**
 * Is this a verification method?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint, so
 * a value outside it cannot be written even by a path that bypasses the
 * domain. This guard is how a row is read **back** through the domain.
 */
export function isVerificationMethod(
  value: unknown,
): value is VerificationMethod {
  return (
    typeof value === 'string' &&
    (VERIFICATION_METHODS as readonly string[]).includes(value)
  );
}
