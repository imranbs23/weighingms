/**
 * MaterialIdentityRepository — the durable record of a verification.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A verification is a fact about something that physically happened
 * (BRD DR-02), so there is no update path and no delete path here — and
 * the database's triggers are the second line of the same guarantee. A
 * repository convention holds against a careless caller; a trigger holds
 * against everyone (ADR-029, ADR-034).
 *
 * THE EFFECTIVE IDENTITY IS THE NEWEST ROW
 * -----------------------------------------
 * Not a flag, not a `superseded_at`. The ordering is **total**:
 * `verified_at DESC, id DESC`. `verified_at` alone is ambiguous when two
 * records land in the same millisecond, and "the latest" must have exactly
 * one answer — two terminals reading the effective identity must not be able
 * to disagree.
 */
import type { MaterialIdentity } from '../entities/material-identity.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export interface MaterialIdentityRepository {
  /**
   * Record a verification.
   *
   * INSERT ONLY. The row's identifier is assigned by the database — it is
   * the **insertion sequence**, and it is what breaks a tie when two
   * verifications land in the same millisecond.
   */
  save(identity: MaterialIdentity): Promise<void>;

  /**
   * The newest verification for a component — the effective one.
   *
   * `null` when nothing has been verified yet. An unverified component is a
   * **state**, not an error.
   */
  latestFor(componentId: ComponentId): Promise<MaterialIdentity | null>;
}
