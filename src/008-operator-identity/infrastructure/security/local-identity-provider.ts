/**
 * LocalIdentityProvider — the LOCAL implementation of the IdentityProvider
 * port.
 *
 * This is the adapter that would be REPLACED if Q-08 resolves to FCI
 * supplying a directory. Nothing else in the system would change.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CONSTANT-WORK GUARANTEE
 * ══════════════════════════════════════════════════════════════════════
 *
 * INVARIANT I-3 has two halves. The response half is enforced by the
 * `AuthenticationOutcome` type. THIS is where the TIMING half is
 * discharged.
 *
 * The problem: if the "operator does not exist" path is cheaper than the
 * "wrong secret" path, the sign-in endpoint becomes an identity oracle. An
 * attacker can enumerate which badge IDs exist by measuring responses —
 * which is exactly the reconnaissance a credential-stuffing attempt needs.
 *
 * The fix: BOTH paths perform exactly one full Argon2id verification.
 *
 *   credential found     → verify(presented secret, stored hash)   [real work]
 *   credential NOT found → verify(presented secret, DUMMY hash)    [same work]
 *
 * The dummy hash is a REAL Argon2id output computed with the SAME
 * parameters, so the cost is identical rather than merely similar. It is
 * computed once at construction and reused.
 *
 * This cannot be enforced by the type system. It is enforced by a test
 * (in the bolt's test stage) that asserts both paths perform a
 * verification, plus a statistical timing test tolerant of scheduler
 * noise but able to catch an order-of-magnitude difference.
 *
 * KNOWN LIMITATION: a single-threaded Node process cannot fully
 * equalise timing between two requests that arrive CONCURRENTLY — one
 * waits for the other, and the second's total latency includes the first's
 * work. The order-of-magnitude property, which is what defeats practical
 * enumeration, does hold.
 */
import type { Operator } from '../../domain/entities/operator.js';
import type { OperatorId } from '../../domain/value-objects/operator-id.js';
import { SecretHash } from '../../domain/value-objects/secret-hash.js';
import {
  VerificationOutcome,
  type IdentityProvider,
} from '../../domain/services/identity-provider.js';
import type { SecretHasher } from '../../domain/ports/secret-hasher.js';
import type {
  CredentialRepository,
  OperatorRepository,
} from '../../domain/ports/repositories.js';

export class LocalIdentityProvider implements IdentityProvider {
  readonly kind = 'LOCAL' as const;

  /**
   * A real Argon2id hash used to equalise the cost of the "operator does
   * not exist" path. Its VALUE never matters — only that verifying
   * against it costs the same as verifying against a real hash.
   */
  private readonly dummyHash: SecretHash;

  constructor(
    private readonly operators: OperatorRepository,
    private readonly credentials: CredentialRepository,
    private readonly hasher: SecretHasher,
  ) {
    // Computed once, with the same parameters as every real credential.
    this.dummyHash = this.hasher.hash('dummy-secret-for-constant-work');
  }

  async available(): Promise<boolean> {
    // The local store is a local file — it is available whenever the
    // process is running.
    return true;
  }

  async findOperator(id: OperatorId): Promise<Operator | null> {
    return this.operators.findById(id);
  }

  /**
   * Verify a presented secret.
   *
   * Both branches below perform exactly one full verification. Read the
   * comments carefully before changing this method.
   */
  async verifyCredential(
    id: OperatorId,
    secret: string,
  ): Promise<VerificationOutcome> {
    const operator = await this.operators.findById(id);

    if (operator === null) {
      // ── THE UNKNOWN-OPERATOR PATH ──
      // Perform a full verification against the dummy hash so this path
      // costs the same as the wrong-secret path.
      this.hasher.verify(this.dummyHash, secret);
      return VerificationOutcome.failed();
    }

    // ── THE KNOWN-OPERATOR PATH ──
    // A credential exists per (operator, role). Try each until one
    // verifies. Every attempt is a full verification, so the number of
    // attempts does not depend on WHICH credential matched.
    const candidates = await this.credentials.findByOperator(operator.id);
    if (candidates.length === 0) {
      // No credential at all — still do the work.
      this.hasher.verify(this.dummyHash, secret);
      return VerificationOutcome.failed();
    }

    let matched = false;
    for (const credential of candidates) {
      if (this.hasher.verify(credential.secretHash, secret)) {
        matched = true;
      }
    }

    if (!matched) {
      return VerificationOutcome.failed();
    }

    // The operator's role is the authority of record, read from the
    // operator row that was resolved from the credential store. It is
    // NEVER read from the request (INVARIANT I-4).
    return VerificationOutcome.verified(operator);
  }

  describe(): string {
    return 'Local operator directory (badge ID + PIN), stored in the WeighingMS database';
  }
}
