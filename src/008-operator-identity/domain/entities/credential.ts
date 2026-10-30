/**
 * Credential — the stored secret for one (operator, role) pair.
 *
 * INVARIANT I-1: only a SecretHash is stored, never a plaintext secret.
 * The type enforces this — `Credential` has no field that could hold one.
 *
 * INVARIANT I-4: the role on the credential is the AUTHORITY OF RECORD. The
 * session's role is copied from here and nowhere else, so a client cannot
 * elevate itself by asking for a role.
 */
import { OperatorId } from '../value-objects/operator-id.js';
import { OperatorRole } from '../value-objects/operator-role.js';
import { SecretHash } from '../value-objects/secret-hash.js';

export class Credential {
  constructor(
    readonly operatorId: OperatorId,
    readonly role: OperatorRole,
    readonly secretHash: SecretHash,
    readonly rotatedAt: Date,
  ) {}

  /**
   * Build a credential from a hash produced by the hashing port.
   *
   * The plaintext secret is NOT a parameter — it never enters the domain.
   * The hashing happens in `CredentialService`, which owns the only scope in
   * which a plaintext secret exists.
   */
  static fromHash(
    operatorId: OperatorId,
    role: OperatorRole,
    secretHash: SecretHash,
    rotatedAt: Date,
  ): Credential {
    return new Credential(operatorId, role, secretHash, rotatedAt);
  }
}
