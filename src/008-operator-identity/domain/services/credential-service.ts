/**
 * CredentialService — creates, rotates and verifies credentials.
 *
 * The plaintext secret exists ONLY in the scope of this service's
 * `create`/`rotate` methods and the `SecretHasher` it delegates to. It is
 * never returned, never stored, and never logged.
 */
import { Credential } from '../entities/credential.js';
import type { OperatorId } from '../value-objects/operator-id.js';
import type { OperatorRole } from '../value-objects/operator-role.js';
import type { SecretHasher } from '../ports/secret-hasher.js';
import type { CredentialRepository } from '../ports/repositories.js';

export class CredentialService {
  constructor(
    private readonly hasher: SecretHasher,
    private readonly credentials: CredentialRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Create a credential for one (operator, role) pair.
   *
   * The secret is hashed immediately and the plaintext is not retained.
   */
  async create(
    operatorId: OperatorId,
    role: OperatorRole,
    secret: string,
  ): Promise<Credential> {
    const secretHash = this.hasher.hash(secret);
    const credential = Credential.fromHash(
      operatorId,
      role,
      secretHash,
      this.now(),
    );
    await this.credentials.save(credential);
    return credential;
  }

  /**
   * Rotate a credential's secret.
   *
   * Rotation replaces the hash. It does NOT invalidate a live session —
   * the story is explicit that "rotation invalidates the credential, not
   * the session already established".
   */
  async rotate(
    operatorId: OperatorId,
    role: OperatorRole,
    newSecret: string,
  ): Promise<Credential> {
    const secretHash = this.hasher.hash(newSecret);
    const rotatedAt = this.now();
    const credential = Credential.fromHash(
      operatorId,
      role,
      secretHash,
      rotatedAt,
    );
    await this.credentials.save(credential);
    return credential;
  }

  /**
   * Verify a presented secret against a stored credential.
   *
   * Delegates to the hasher, which performs the full verification cost even
   * on a miss — the obligation behind invariant I-3.
   */
  verify(credential: Credential, presentedSecret: string): boolean {
    return this.hasher.verify(credential.secretHash, presentedSecret);
  }
}
