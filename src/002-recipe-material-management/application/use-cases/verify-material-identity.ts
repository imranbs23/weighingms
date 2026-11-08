/**
 * VerifyMaterialIdentity — establishing that the material in hand is the
 * material the recipe calls for.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO ROUTES, ONE OUTCOME, AND THE METHOD IS DERIVED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scan path and the attestation path are **equally supported** states,
 * each with its own tests. Whether dyestuffs carry scannable barcodes at
 * all is **Q-07** (assumption A-10), and this unit asserts neither answer
 * — switching between scan-first and attestation-first is a configuration
 * change, not a rewrite.
 *
 * **The method is derived from the request's shape**, never supplied
 * (ADR-030, ADR-034): a `code` means the scanner read it, and an
 * `attestation` means the operator confirmed it. There is no
 * `verifiedBy` field anywhere, so a client cannot record a scan that never
 * happened.
 *
 * THE OPERATOR COMES FROM THE SESSION
 * -----------------------------------
 * Never from a request body. The identity is an immutable traceability
 * record, so a false attribution could only ever be contradicted, never
 * corrected (ADR-005).
 *
 * A MISMATCH IS A HARD STOP
 * -------------------------
 * And it **writes nothing** — the refusal path returns before the
 * repository is touched, so the history contains only acts that happened,
 * and a refused verification can never be the effective one.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  ComponentId,
  DyestuffCode,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { MaterialIdentity } from '../../domain/entities/material-identity.js';
import type { Recipe } from '../../domain/entities/recipe.js';
import type { MaterialIdentityRepository } from '../../domain/ports/material-identity-repository.js';
import type { DyestuffScanner } from '../../domain/ports/dyestuff-scanner.js';
import { MaterialIdentityVerifier } from '../../domain/services/material-identity-verifier.js';
import { RecipeWorkingCopy } from '../../domain/services/recipe-working-copy.js';
import { AttestedClaims } from '../../domain/value-objects/attested-claims.js';

export type VerifyIdentityOutcome =
  | {
      readonly kind: 'VERIFIED';
      readonly identity: MaterialIdentity;
    }
  | {
      /**
       * The scanned code named a **different** material.
       *
       * A hard stop. It carries **both** codes, because the operator must
       * be told which was expected and which was presented — and because
       * the story requires it in as many words.
       */
      readonly kind: 'MISMATCHED';
      readonly scannedCode: string;
      readonly expectedCode: string;
    }
  | {
      /**
       * The scanner could not be read.
       *
       * Distinct from a mismatch: nothing was attempted, so there is no
       * code to have mismatched. The operator is told the scanner is
       * unavailable and the **attestation path is offered** (BRD FR-19,
       * BRD IR-15, BRD IR-18).
       */
      readonly kind: 'SCANNER_UNAVAILABLE';
      readonly message: string;
    }
  | {
      /**
       * The component is already verified by a **scan**, and an
       * attestation may not downgrade it.
       *
       * Distinct from a mismatch: nothing is wrong — the material **is**
       * verified. The attestation is simply **not permitted** (the story's
       * edge case), so it is not recorded and the scan stays effective.
       */
      readonly kind: 'ALREADY_VERIFIED_BY_SCAN';
      readonly message: string;
    }
  | {
      /** The recipe holds no such component. */
      readonly kind: 'UNKNOWN_COMPONENT';
      readonly message: string;
    };

export interface VerifyMaterialIdentityOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** The device the code is read from. */
  readonly scanner: DyestuffScanner;
  /** Where the verification is recorded. */
  readonly identities: MaterialIdentityRepository;
  /** The comparison rule. */
  readonly verifier: MaterialIdentityVerifier;
  /** The clock — the verification is timestamped. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. The detail never reaches the client. */
  readonly onError?: (detail: string) => void;
}

export class VerifyMaterialIdentity {
  constructor(private readonly options: VerifyMaterialIdentityOptions) {}

  /**
   * Verify by **scan**.
   *
   * The scanner is read; the code is compared against the component's
   * required dyestuff code; and the result is recorded — or refused.
   */
  async verifyByScan(
    componentId: string,
    operatorId: OperatorId,
  ): Promise<VerifyIdentityOutcome> {
    const component = this.findComponent(componentId);
    if (component === null) {
      return this.unknownComponent(componentId);
    }

    const scan = await this.options.scanner.read();

    if (scan.kind === 'NO_CODE') {
      this.options.onError?.(
        `[material-identity] the scanner produced no code: ${scan.message}`,
      );
      return { kind: 'SCANNER_UNAVAILABLE', message: scan.message };
    }

    const comparison = this.options.verifier.verify(
      scan.code,
      component.dyestuffCode,
    );

    if (comparison.kind === 'MISMATCHED') {
      // A HARD STOP. Nothing is written, and there is no path from here to
      // an attestation.
      this.options.onError?.(
        `[material-identity] component ${component.componentId.value} requires ${comparison.expectedCode} but "${comparison.scannedCode}" was scanned`,
      );
      return {
        kind: 'MISMATCHED',
        scannedCode: comparison.scannedCode,
        expectedCode: comparison.expectedCode,
      };
    }

    const identity = new MaterialIdentity(
      component.componentId,
      component.dyestuffCode,
      'SCAN',
      operatorId,
      Instant.of(this.options.clock()),
      comparison.code,
      null,
    );

    await this.options.identities.save(identity);
    return { kind: 'VERIFIED', identity };
  }

  /**
   * Verify by **attestation**.
   *
   * The operator confirmed the identity on screen. The attestation is a
   * **decision**, and it is recorded as one — with the operator, the time
   * and the claims (B-6, BRD BR-11).
   *
   * **And it never downgrades a scan.** If the component is already
   * verified by a **scan**, the attestation is refused: a scan is the
   * stronger claim, and the story is explicit that an attestation *"is not
   * permitted to downgrade a scan."*
   */
  async verifyByAttestation(
    componentId: string,
    operatorId: OperatorId,
  ): Promise<VerifyIdentityOutcome> {
    const component = this.findComponent(componentId);
    if (component === null) {
      return this.unknownComponent(componentId);
    }

    const existing = await this.options.identities.latestFor(
      component.componentId,
    );

    if (existing !== null && existing.verifiedBy === 'SCAN') {
      // A scan is the stronger claim, and the attestation is **not**
      // recorded. The history keeps the scan, and the scan stays effective.
      this.options.onError?.(
        `[material-identity] component ${component.componentId.value} is already verified by scan; an attestation may not downgrade it`,
      );
      return {
        kind: 'ALREADY_VERIFIED_BY_SCAN',
        message: 'This component is already verified by scan',
      };
    }

    const identity = new MaterialIdentity(
      component.componentId,
      component.dyestuffCode,
      'ATTESTATION',
      operatorId,
      Instant.of(this.options.clock()),
      null,
      AttestedClaims.dyestuffCode(),
    );

    await this.options.identities.save(identity);
    return { kind: 'VERIFIED', identity };
  }

  /**
   * The effective verification for a component — the newest one.
   *
   * `null` when nothing has been verified yet. An unverified component is a
   * **state**, not an error.
   */
  async current(componentId: string): Promise<MaterialIdentity | null> {
    const component = this.findComponent(componentId);
    if (component === null) return null;
    return this.options.identities.latestFor(component.componentId);
  }

  /** The component in the recipe, or `null`. */
  private findComponent(
    componentId: string,
  ): Recipe['components'][number] | null {
    const recipe = this.options.workingCopy.current();
    if (recipe === null) return null;
    return recipe.componentById(componentId);
  }

  private unknownComponent(componentId: string): VerifyIdentityOutcome {
    this.options.onError?.(
      `[material-identity] the recipe has no component ${componentId}`,
    );
    return {
      kind: 'UNKNOWN_COMPONENT',
      message: `The recipe has no component ${componentId}`,
    };
  }
}

/**
 * The dyestuff code a component requires.
 *
 * Exported for the tests, which assert the exact comparison — and for a
 * future bolt that needs the expected code without the whole component.
 */
export function expectedDyestuffCode(component: {
  readonly dyestuffCode: DyestuffCode;
}): string {
  return component.dyestuffCode.value;
}

/**
 * The component's id, as the identifier type.
 *
 * Exported for the tests, which build a component from a raw id.
 */
export function componentIdOf(raw: string): ComponentId {
  return ComponentId.create(raw);
}
