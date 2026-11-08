/**
 * SqliteMaterialIdentityRepository — the durable record of a verification.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite a verification (BRD DR-02). The database's triggers are
 * the second line of the same guarantee — a repository convention holds
 * against a careless caller; a trigger holds against everyone (ADR-034).
 *
 * THE EFFECTIVE IDENTITY IS THE NEWEST ROW
 * -----------------------------------------
 * Not a flag, not a `superseded_at`. The ordering is **total**:
 * `verified_at DESC, id DESC`. `verified_at` alone is ambiguous when two
 * records land in the same millisecond, and "the latest" must have exactly
 * one answer — two terminals reading the effective identity must not be
 * able to disagree.
 */
import { MaterialIdentity } from '../../domain/entities/material-identity.js';
import type { MaterialIdentityRepository } from '../../domain/ports/material-identity-repository.js';
import {
  isVerificationMethod,
} from '../../domain/value-objects/verification-method.js';
import { AttestedClaims } from '../../domain/value-objects/attested-claims.js';
import {
  ComponentId,
  DyestuffCode,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SqliteDatabase } from './material-database.js';

interface IdentityRow {
  id: number;
  component_id: string;
  material_code: string;
  verified_by: string;
  operator_id: string;
  verified_at: string;
  barcode: string | null;
  attested_claims: string | null;
  recorded_at: string;
}

export class SqliteMaterialIdentityRepository
  implements MaterialIdentityRepository
{
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The row's identifier is assigned by the database — it is the
   * **insertion sequence**, and it is what breaks a tie when two
   * verifications land in the same millisecond.
   *
   * The `verified_at` is the **act's** time while `recorded_at` is the
   * **write's** time — two different moments, kept apart deliberately.
   */
  async save(identity: MaterialIdentity): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO material_identities
           (component_id, material_code, verified_by, operator_id,
            verified_at, barcode, attested_claims, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        identity.componentId.value,
        identity.materialCode.value,
        identity.verifiedBy,
        identity.operatorId.value,
        identity.verifiedAt.toString(),
        identity.barcode,
        identity.attestedClaims === null
          ? null
          : identity.attestedClaims.toStorage(),
        this.clock().toISOString(),
      );
  }

  /**
   * The newest verification for a component — the effective one.
   *
   * `null` when nothing has been verified yet. An unverified component is a
   * **state**, not an error.
   */
  async latestFor(
    componentId: ComponentId,
  ): Promise<MaterialIdentity | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM material_identities
          WHERE component_id = ?
          ORDER BY verified_at DESC, id DESC
          LIMIT 1`,
      )
      .get(componentId.value) as unknown as IdentityRow | undefined;

    return row === undefined ? null : toIdentity(row);
  }
}

/**
 * Rebuild an identity from its row.
 *
 * The method is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toIdentity(row: IdentityRow): MaterialIdentity {
  if (!isVerificationMethod(row.verified_by)) {
    throw new Error(
      `The stored verification method "${row.verified_by}" is not one this product records`,
    );
  }

  return new MaterialIdentity(
    ComponentId.create(row.component_id),
    DyestuffCode.create(row.material_code),
    row.verified_by,
    OperatorId.create(row.operator_id),
    Instant.of(new Date(row.verified_at)),
    row.barcode,
    row.attested_claims === null
      ? null
      : AttestedClaims.fromStorage(row.attested_claims),
  );
}
