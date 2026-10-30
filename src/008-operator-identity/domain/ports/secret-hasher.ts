/**
 * SecretHasher — the port through which credentials are hashed and verified.
 *
 * This is the ONLY place in the system where a plaintext secret is in
 * scope. Nothing else calls a hashing function, and nothing else sees a
 * secret.
 *
 * The `verify` contract has one obligation that the type system cannot
 * express and that must be honoured by every implementation:
 *
 *   verify() performs the FULL cost of a verification on a MISS, and does
 *   not short-circuit.
 *
 * That obligation is what makes the "no such operator" path cost the same
 * as the "wrong secret" path, which is the timing half of invariant I-3.
 * See `LocalIdentityProvider` for how it is discharged.
 */
import type { SecretHash } from '../value-objects/secret-hash.js';

export interface SecretHasher {
  /** Hash a plaintext secret into a self-describing SecretHash. */
  hash(secret: string): SecretHash;

  /**
   * Verify a presented secret against a stored hash.
   *
   * MUST perform the full verification cost even when the secret does not
   * match.
   */
  verify(hash: SecretHash, presentedSecret: string): boolean;
}
