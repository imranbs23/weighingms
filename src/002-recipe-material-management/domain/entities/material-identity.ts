/**
 * MaterialIdentity — the verification that the material in hand is the
 * material the recipe calls for.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 08:14:22, operator OP-001 presented DYE-4471 to the scanner and it
 * matched"* is a fact about something that physically happened. BRD DR-02
 * requires that such a record not be revised — and corrections are **new
 * records**.
 *
 * So this class exposes **no mutator**. There is no `withMethod`, no
 * `reverify`, no `setCode`. The effective identity is the **newest row**,
 * and the history is retained (ADR-034).
 *
 * THE METHOD IS DERIVED, NEVER SUPPLIED
 * -------------------------------------
 * A `SCAN` carries the scanned code; an `ATTESTATION` carries the claims
 * and **no** code. A record that carried both would be claiming the machine
 * read a label *and* that the operator vouched for it — and the two are
 * different claims with different strength.
 *
 * The constructor enforces that: a `SCAN` without a barcode, or an
 * `ATTESTATION` with one, is refused.
 *
 * AND THE OPERATOR COMES FROM THE SESSION
 * ----------------------------------------
 * Never from a request body — the record is an immutable traceability
 * record, so a false attribution could only ever be contradicted, never
 * corrected (ADR-005, ADR-034).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type {
  ComponentId,
  DyestuffCode,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { VerificationMethod } from '../value-objects/verification-method.js';
import type { AttestedClaims } from '../value-objects/attested-claims.js';

export class MaterialIdentity {
  constructor(
    /** The recipe slot this verification is about. */
    readonly componentId: ComponentId,
    /** The material the component **requires** — the MES's fact. */
    readonly materialCode: DyestuffCode,
    /** How the identity was established. */
    readonly verifiedBy: VerificationMethod,
    /** Who established it — from the session. */
    readonly operatorId: OperatorId,
    /** **When the act happened.** */
    readonly verifiedAt: Instant,
    /**
     * The scanned code — **only** when the method is `SCAN`.
     *
     * `null` for an attestation, and the constructor refuses a `SCAN`
     * without one.
     */
    readonly barcode: string | null,
    /**
     * The attested claims — **only** when the method is `ATTESTATION`.
     *
     * `null` for a scan, and the constructor refuses an `ATTESTATION`
     * without them.
     */
    readonly attestedClaims: AttestedClaims | null,
  ) {
    if (verifiedBy === 'SCAN' && barcode === null) {
      throw new Error('A scanned identity must carry the scanned code');
    }
    if (verifiedBy === 'ATTESTATION' && attestedClaims === null) {
      throw new Error('An attested identity must carry the attested claims');
    }
    if (verifiedBy === 'SCAN' && attestedClaims !== null) {
      throw new Error('A scanned identity carries no attested claims');
    }
    if (verifiedBy === 'ATTESTATION' && barcode !== null) {
      throw new Error('An attested identity carries no scanned code');
    }
  }
}
