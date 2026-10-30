/**
 * SqliteCredentialRepository.
 *
 * This adapter exposes NO method that could return a plaintext secret. It
 * returns `Credential` objects, which by construction hold only a
 * SecretHash. There is deliberately no `findSecretByOperator` for anything
 * to call.
 */
import type { CredentialRepository } from '../../domain/ports/repositories.js';
import { Credential } from '../../domain/entities/credential.js';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { OperatorRole } from '../../domain/value-objects/operator-role.js';
import { SecretHash } from '../../domain/value-objects/secret-hash.js';
import type { SqliteDatabase } from './database.js';

interface CredentialRow {
  operator_id: string;
  role: string;
  secret_hash: string;
  rotated_at: string;
}

export class SqliteCredentialRepository implements CredentialRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findByOperatorAndRole(
    operatorId: OperatorId,
    role: OperatorRole,
  ): Promise<Credential | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM credentials WHERE operator_id = ? AND role = ?',
      )
      .get(operatorId.value, role.value) as unknown as CredentialRow | undefined;
    return row ? this.toCredential(row) : null;
  }

  async findByOperator(operatorId: OperatorId): Promise<Credential[]> {
    const rows = this.db
      .prepare('SELECT * FROM credentials WHERE operator_id = ? ORDER BY role')
      .all(operatorId.value) as unknown as CredentialRow[];
    return rows.map((row) => this.toCredential(row));
  }

  async save(credential: Credential): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO credentials (operator_id, role, secret_hash, rotated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(operator_id, role) DO UPDATE SET
           secret_hash = excluded.secret_hash,
           rotated_at  = excluded.rotated_at`,
      )
      .run(
        credential.operatorId.value,
        credential.role.value,
        credential.secretHash.encoded,
        credential.rotatedAt.toISOString(),
      );
  }

  private toCredential(row: CredentialRow): Credential {
    // The stored hash is SELF-DESCRIBING — it carries its own algorithm and
    // parameters, so the work factor can be raised later without
    // invalidating this row. Parsing it here keeps the format knowledge
    // in one place.
    return Credential.fromHash(
      OperatorId.create(row.operator_id),
      OperatorRole.fromStored(row.role),
      SecretHash.parse(row.secret_hash),
      new Date(row.rotated_at),
    );
  }
}
