/**
 * IdentityProvider — THE SEAM for Q-08.
 *
 * Q-08 asks whether FCI supplies its own operator directory. It is
 * undecided, owned by FCI IT, and may be answered after this build ships.
 *
 * This interface is the whole answer to that question. It has exactly two
 * implementations in view: `LOCAL` (shipped) and a future `DIRECTORY`.
 *
 * WHAT THE INTERFACE DELIBERATELY DOES NOT HAVE:
 *
 *   - no method that returns a plaintext secret,
 *   - no method that returns a session,
 *   - no method that mutates an operator's role.
 *
 * The provider answers "is this credential valid, and who is this
 * operator?" and nothing else. Session management, hashing policy and
 * expiry belong to this context regardless of where the identity came
 * from. If a DIRECTORY provider were added tomorrow it would verify
 * credentials and return an operator; the session, the token and the expiry
 * rules would be unchanged, and no consuming unit would notice.
 */
import type { Operator } from '../entities/operator.js';
import type { OperatorId } from '../value-objects/operator-id.js';

/**
 * The result of verifying a credential against an identity source.
 *
 * There is deliberately NO field distinguishing "no such operator" from
 * "wrong secret". A `DIRECTORY` implementation would have the same
 * difficulty distinguishing them as the local one, and the type makes it
 * impossible to leak the distinction to a caller.
 */
export class VerificationOutcome {
  private constructor(
    private readonly operator: Operator | null,
    private readonly verified: boolean,
  ) {}

  static verified(operator: Operator): VerificationOutcome {
    return new VerificationOutcome(operator, true);
  }

  /**
   * A failed verification.
   *
   * The operator is NOT carried on failure — a failed outcome says nothing
   * about whether the operator exists, so it cannot be turned into an
   * identity oracle by a careless caller.
   */
  static failed(): VerificationOutcome {
    return new VerificationOutcome(null, false);
  }

  isVerified(): boolean {
    return this.verified;
  }

  getOperator(): Operator | null {
    return this.operator;
  }
}

export interface IdentityProvider {
  /** Which source this is — `LOCAL` or `DIRECTORY`. */
  readonly kind: 'LOCAL' | 'DIRECTORY';

  /** Whether the source is currently reachable and usable. */
  available(): Promise<boolean>;

  /** Look up an operator by identity. */
  findOperator(id: OperatorId): Promise<Operator | null>;

  /**
   * Verify a presented secret against the identity source.
   *
   * Implementations MUST perform equivalent work on every failure path, so
   * that the response does not disclose whether the identity exists.
   */
  verifyCredential(id: OperatorId, secret: string): Promise<VerificationOutcome>;

  /** A human-readable description, for diagnostics and the API. */
  describe(): string;
}
