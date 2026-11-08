/**
 * The material identity and the lot capture — unit 002, bolt 011.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RULES, NOT THE WIRING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the comparison is EXACT — a case-folded match would be a wrong
 *     material accepted as a right one
 *   - a mismatch is a HARD STOP, and it writes nothing
 *   - the method is DERIVED, never supplied
 *   - an attestation never downgrades a scan, and a scan never downgrades
 *     an attestation
 *   - the three lot routes are one operation with different evidence
 *   - the MES's lot wins and is not overwritten
 *   - the operator's paths remain available during an outage
 *   - an empty lot is refused; a long lot is refused, not truncated
 *   - the lot is trimmed before it is stored
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  LotNumber,
  ShadeCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { Recipe } from '../../src/002-recipe-material-management/domain/entities/recipe.js';
import { RecipeComponent } from '../../src/002-recipe-material-management/domain/entities/recipe-component.js';
import { MaterialIdentity } from '../../src/002-recipe-material-management/domain/entities/material-identity.js';
import { MaterialLotCapture } from '../../src/002-recipe-material-management/domain/entities/material-lot-capture.js';
import { MaterialIdentityVerifier } from '../../src/002-recipe-material-management/domain/services/material-identity-verifier.js';
import { LotValidator } from '../../src/002-recipe-material-management/domain/services/lot-validator.js';
import { AttestedClaims } from '../../src/002-recipe-material-management/domain/value-objects/attested-claims.js';
import { RecipeWorkingCopy } from '../../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import { VerifyMaterialIdentity } from '../../src/002-recipe-material-management/application/use-cases/verify-material-identity.js';
import { CaptureMaterialLot } from '../../src/002-recipe-material-management/application/use-cases/capture-material-lot.js';
import type { DyestuffScanner } from '../../src/002-recipe-material-management/domain/ports/dyestuff-scanner.js';
import type { DyestuffMasterSource } from '../../src/002-recipe-material-management/domain/ports/dyestuff-master-source.js';
import type { MaterialIdentityRepository } from '../../src/002-recipe-material-management/domain/ports/material-identity-repository.js';
import type { MaterialLotRepository } from '../../src/002-recipe-material-management/domain/ports/material-lot-repository.js';
import type { ComponentId as ComponentIdType } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';

const AT = Instant.of(new Date('2026-11-06T08:14:22.000Z'));
const OPERATOR = OperatorId.create('OP-001');

function component(
  id: string,
  dyestuffCode: string,
  sequence = 1,
): RecipeComponent {
  return new RecipeComponent(
    sequence,
    ComponentId.create(id),
    DyestuffCode.create(dyestuffCode),
    WeightValue.of('94.0000', 'g'),
    Tolerance.of(WeightValue.of('93.5000', 'g'), WeightValue.of('94.5000', 'g')),
    'PRECISION',
    null,
    null,
    'PENDING',
  );
}

function recipe(components: readonly RecipeComponent[]): Recipe {
  return new Recipe(
    BatchId.create('B-24187'),
    ShadeCode.create('Teal 4C'),
    components,
    AT,
    'DUMMY_ORGATEX',
    { kind: 'CURRENT' },
  );
}

/** A scanner that reads a fixed code, or nothing. */
class StubScanner implements DyestuffScanner {
  code: string | null = null;

  async read() {
    if (this.code === null) {
      return { kind: 'NO_CODE' as const, message: 'nothing was presented' };
    }
    const code = this.code;
    this.code = null;
    return { kind: 'CODE_READ' as const, code };
  }
}

/** A master that holds a lot, holds none, or is unreachable. */
class StubMaster implements DyestuffMasterSource {
  lot: string | null = null;
  unavailable = false;

  async readLot(_componentId: ComponentIdType) {
    if (this.unavailable) {
      return {
        kind: 'UNAVAILABLE' as const,
        reason: 'UNREACHABLE' as const,
        message: 'the MES is down',
      };
    }
    if (this.lot === null) return { kind: 'NO_LOT' as const };
    return { kind: 'LOT_HELD' as const, lotNumber: this.lot };
  }
}

/** A repository that keeps everything it is given, in order. */
class StubIdentities implements MaterialIdentityRepository {
  readonly saved: MaterialIdentity[] = [];

  async save(identity: MaterialIdentity): Promise<void> {
    this.saved.push(identity);
  }

  async latestFor(_componentId: ComponentIdType): Promise<MaterialIdentity | null> {
    const last = this.saved[this.saved.length - 1];
    return last === undefined ? null : last;
  }
}

/** A repository that keeps everything it is given, in order. */
class StubLots implements MaterialLotRepository {
  readonly saved: MaterialLotCapture[] = [];

  async save(capture: MaterialLotCapture): Promise<void> {
    this.saved.push(capture);
  }

  async latestFor(_componentId: ComponentIdType): Promise<MaterialLotCapture | null> {
    const last = this.saved[this.saved.length - 1];
    return last === undefined ? null : last;
  }
}

function identityUseCase(
  scanner: DyestuffScanner,
  identities: MaterialIdentityRepository,
  workingCopy: RecipeWorkingCopy,
) {
  return new VerifyMaterialIdentity({
    workingCopy,
    scanner,
    identities,
    verifier: new MaterialIdentityVerifier(),
    clock: () => new Date('2026-11-06T08:14:22.000Z'),
  });
}

function lotUseCase(
  master: DyestuffMasterSource,
  lots: MaterialLotRepository,
  workingCopy: RecipeWorkingCopy,
) {
  return new CaptureMaterialLot({
    workingCopy,
    master,
    lots,
    validator: new LotValidator(),
    clock: () => new Date('2026-11-06T08:14:22.000Z'),
  });
}

describe('the material identity verifier', () => {
  const verifier = new MaterialIdentityVerifier();
  const expected = DyestuffCode.create('DYE-4471');

  it('matches the exact code', () => {
    const outcome = verifier.verify('DYE-4471', expected);
    expect(outcome.kind).toBe('MATCHES');
  });

  it('trims the presented code before comparing', () => {
    expect(verifier.verify('  DYE-4471  ', expected).kind).toBe('MATCHES');
  });

  // A case-folded match would be a wrong material accepted as a right one.
  it('does NOT case-fold — a different case is a MISMATCH', () => {
    const outcome = verifier.verify('dye-4471', expected);
    expect(outcome.kind).toBe('MISMATCHED');
    if (outcome.kind !== 'MISMATCHED') return;
    expect(outcome.scannedCode).toBe('dye-4471');
    expect(outcome.expectedCode).toBe('DYE-4471');
  });

  it('names BOTH codes on a mismatch', () => {
    const outcome = verifier.verify('DYE-9999', expected);
    expect(outcome.kind).toBe('MISMATCHED');
    if (outcome.kind !== 'MISMATCHED') return;
    expect(outcome.scannedCode).toBe('DYE-9999');
    expect(outcome.expectedCode).toBe('DYE-4471');
  });
});

describe('the lot validator', () => {
  const validator = new LotValidator();

  it('accepts a lot and TRIMS it', () => {
    const outcome = validator.validate('  2026-0387  ');
    expect(outcome.kind).toBe('VALID');
    if (outcome.kind !== 'VALID') return;
    expect(outcome.lotNumber.value).toBe('2026-0387');
  });

  it('refuses an EMPTY lot', () => {
    expect(validator.validate('   ').kind).toBe('EMPTY');
  });

  it('accepts exactly 64 characters', () => {
    expect(validator.validate('x'.repeat(64)).kind).toBe('VALID');
  });

  it('refuses 65 characters — and does NOT truncate', () => {
    const outcome = validator.validate('x'.repeat(65));
    expect(outcome.kind).toBe('TOO_LONG');
    if (outcome.kind !== 'TOO_LONG') return;
    expect(outcome.maximum).toBe(64);
    expect(outcome.length).toBe(65);
  });
});

describe('the attested claims', () => {
  it('is a SET — the same claim twice is one claim', () => {
    const claims = AttestedClaims.of(['dyestuffCode', 'dyestuffCode']);
    expect(claims.size).toBe(1);
  });

  it('is canonical — the stored form does not depend on the order', () => {
    expect(AttestedClaims.of(['dyestuffCode']).toStorage()).toBe('dyestuffCode');
  });

  it('refuses a claim nobody defined', () => {
    expect(() => AttestedClaims.of(['lotNumber'])).toThrow();
  });

  it('reads an empty stored form back as the EMPTY set', () => {
    expect(AttestedClaims.fromStorage('').size).toBe(0);
  });
});

describe('the material identity record', () => {
  const base = {
    componentId: ComponentId.create('DYE-4471-Y'),
    materialCode: DyestuffCode.create('DYE-4471'),
    operatorId: OPERATOR,
    verifiedAt: AT,
  };

  it('accepts a scan with a code', () => {
    const identity = new MaterialIdentity(
      base.componentId,
      base.materialCode,
      'SCAN',
      base.operatorId,
      base.verifiedAt,
      'DYE-4471',
      null,
    );
    expect(identity.verifiedBy).toBe('SCAN');
  });

  it('refuses a scan with NO code', () => {
    expect(
      () =>
        new MaterialIdentity(
          base.componentId,
          base.materialCode,
          'SCAN',
          base.operatorId,
          base.verifiedAt,
          null,
          null,
        ),
    ).toThrow();
  });

  it('refuses an attestation with a code', () => {
    expect(
      () =>
        new MaterialIdentity(
          base.componentId,
          base.materialCode,
          'ATTESTATION',
          base.operatorId,
          base.verifiedAt,
          'DYE-4471',
          AttestedClaims.dyestuffCode(),
        ),
    ).toThrow();
  });
});

describe('verifying a material identity', () => {
  it('verifies by a matching scan, and records it', async () => {
    const scanner = new StubScanner();
    scanner.code = 'DYE-4471';
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await identityUseCase(scanner, identities, workingCopy).verifyByScan(
      'DYE-4471-Y',
      OPERATOR,
    );

    expect(outcome.kind).toBe('VERIFIED');
    expect(identities.saved).toHaveLength(1);
    expect(identities.saved[0]?.verifiedBy).toBe('SCAN');
    expect(identities.saved[0]?.barcode).toBe('DYE-4471');
    expect(identities.saved[0]?.operatorId.value).toBe('OP-001');
  });

  it('a MISMATCH is a hard stop and writes NOTHING', async () => {
    const scanner = new StubScanner();
    scanner.code = 'DYE-9999';
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await identityUseCase(scanner, identities, workingCopy).verifyByScan(
      'DYE-4471-Y',
      OPERATOR,
    );

    expect(outcome.kind).toBe('MISMATCHED');
    if (outcome.kind !== 'MISMATCHED') return;
    expect(outcome.scannedCode).toBe('DYE-9999');
    expect(outcome.expectedCode).toBe('DYE-4471');
    expect(identities.saved).toHaveLength(0);
  });

  it('an unreadable scan is NOT a mismatch — and nothing is written', async () => {
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await identityUseCase(
      new StubScanner(),
      identities,
      workingCopy,
    ).verifyByScan('DYE-4471-Y', OPERATOR);

    expect(outcome.kind).toBe('SCANNER_UNAVAILABLE');
    expect(identities.saved).toHaveLength(0);
  });

  it('verifies by attestation, and records the claims', async () => {
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await identityUseCase(
      new StubScanner(),
      identities,
      workingCopy,
    ).verifyByAttestation('DYE-4471-Y', OPERATOR);

    expect(outcome.kind).toBe('VERIFIED');
    expect(identities.saved[0]?.verifiedBy).toBe('ATTESTATION');
    expect(identities.saved[0]?.barcode).toBeNull();
    expect(identities.saved[0]?.attestedClaims?.values).toEqual(['dyestuffCode']);
  });

  it('a scan does NOT downgrade an attestation — the scan wins', async () => {
    const scanner = new StubScanner();
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const useCase = identityUseCase(scanner, identities, workingCopy);
    await useCase.verifyByAttestation('DYE-4471-Y', OPERATOR);

    scanner.code = 'DYE-4471';
    const outcome = await useCase.verifyByScan('DYE-4471-Y', OPERATOR);

    expect(outcome.kind).toBe('VERIFIED');
    // Two rows: the attestation, then the scan. The newest is the scan.
    expect(identities.saved).toHaveLength(2);
    expect(identities.saved[1]?.verifiedBy).toBe('SCAN');
  });

  it('an attestation does NOT downgrade a scan — it is REFUSED', async () => {
    const scanner = new StubScanner();
    scanner.code = 'DYE-4471';
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const useCase = identityUseCase(scanner, identities, workingCopy);
    await useCase.verifyByScan('DYE-4471-Y', OPERATOR);

    const outcome = await useCase.verifyByAttestation('DYE-4471-Y', OPERATOR);

    expect(outcome.kind).toBe('ALREADY_VERIFIED_BY_SCAN');
    // Still ONE row — the attestation was not recorded.
    expect(identities.saved).toHaveLength(1);
    expect(identities.saved[0]?.verifiedBy).toBe('SCAN');
  });

  it('refuses a component the recipe does not hold', async () => {
    const identities = new StubIdentities();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await identityUseCase(
      new StubScanner(),
      identities,
      workingCopy,
    ).verifyByAttestation('NOPE', OPERATOR);

    expect(outcome.kind).toBe('UNKNOWN_COMPONENT');
    expect(identities.saved).toHaveLength(0);
  });
});

describe('capturing a material lot', () => {
  it('captures the MES’s own lot as SOURCE', async () => {
    const master = new StubMaster();
    master.lot = '2026-0387';
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(master, lots, workingCopy).captureFromSource(
      'DYE-4471-Y',
      OPERATOR,
    );

    expect(outcome.kind).toBe('CAPTURED');
    expect(lots.saved[0]?.captureMethod).toBe('SOURCE');
    expect(lots.saved[0]?.lotNumber.value).toBe('2026-0387');
  });

  it('captures a keyed-in lot as KEYED_IN', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(new StubMaster(), lots, workingCopy).captureKeyedIn(
      'DYE-4471-Y',
      '  2026-0387  ',
      OPERATOR,
    );

    expect(outcome.kind).toBe('CAPTURED');
    expect(lots.saved[0]?.captureMethod).toBe('KEYED_IN');
    // The stored value is the TRIMMED form.
    expect(lots.saved[0]?.lotNumber.value).toBe('2026-0387');
  });

  it('captures a scanned lot as SCAN', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(new StubMaster(), lots, workingCopy).captureScanned(
      'DYE-4471-Y',
      'L-77120',
      OPERATOR,
    );

    expect(outcome.kind).toBe('CAPTURED');
    expect(lots.saved[0]?.captureMethod).toBe('SCAN');
  });

  it('refuses an EMPTY lot and writes nothing', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(new StubMaster(), lots, workingCopy).captureKeyedIn(
      'DYE-4471-Y',
      '   ',
      OPERATOR,
    );

    expect(outcome.kind).toBe('EMPTY_LOT');
    expect(lots.saved).toHaveLength(0);
  });

  it('refuses a lot over 64 characters — and does NOT truncate', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(new StubMaster(), lots, workingCopy).captureKeyedIn(
      'DYE-4471-Y',
      'x'.repeat(65),
      OPERATOR,
    );

    expect(outcome.kind).toBe('LOT_TOO_LONG');
    expect(lots.saved).toHaveLength(0);
  });

  it('the MES holding NO lot is not an error', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await lotUseCase(new StubMaster(), lots, workingCopy).captureFromSource(
      'DYE-4471-Y',
      OPERATOR,
    );

    expect(outcome.kind).toBe('NO_SOURCE_LOT');
    expect(lots.saved).toHaveLength(0);
  });

  it('an unreachable MES leaves the operator’s path AVAILABLE', async () => {
    const master = new StubMaster();
    master.unavailable = true;
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const useCase = lotUseCase(master, lots, workingCopy);

    const source = await useCase.captureFromSource('DYE-4471-Y', OPERATOR);
    expect(source.kind).toBe('SOURCE_UNAVAILABLE');

    // The operator's path still works — and the method records that the
    // lot was NOT source-held.
    const keyed = await useCase.captureKeyedIn('DYE-4471-Y', '2026-0387', OPERATOR);
    expect(keyed.kind).toBe('CAPTURED');
    expect(lots.saved[0]?.captureMethod).toBe('KEYED_IN');
  });

  it('captures the same lot for two components — and does NOT de-duplicate', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(
      recipe([
        component('DYE-4471-Y', 'DYE-4471', 1),
        component('DYE-4471-B', 'DYE-1180', 2),
      ]),
    );

    const useCase = lotUseCase(new StubMaster(), lots, workingCopy);
    await useCase.captureKeyedIn('DYE-4471-Y', '2026-0387', OPERATOR);
    await useCase.captureKeyedIn('DYE-4471-B', '2026-0387', OPERATOR);

    expect(lots.saved).toHaveLength(2);
  });

  it('two lots for one component — the newest is effective, the older is RETAINED', async () => {
    const lots = new StubLots();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const useCase = lotUseCase(new StubMaster(), lots, workingCopy);
    await useCase.captureKeyedIn('DYE-4471-Y', 'FIRST', OPERATOR);
    await useCase.captureKeyedIn('DYE-4471-Y', 'SECOND', OPERATOR);

    expect(lots.saved).toHaveLength(2);
    const effective = await useCase.current('DYE-4471-Y');
    expect(effective?.lotNumber.value).toBe('SECOND');
  });
});

describe('the lot capture record', () => {
  it('carries the component, the lot, the material, the method and the operator', () => {
    const capture = new MaterialLotCapture(
      ComponentId.create('DYE-4471-Y'),
      LotNumber.create('2026-0387'),
      DyestuffCode.create('DYE-4471'),
      'KEYED_IN',
      OPERATOR,
      AT,
    );

    expect(capture.componentId.value).toBe('DYE-4471-Y');
    expect(capture.lotNumber.value).toBe('2026-0387');
    expect(capture.materialCode.value).toBe('DYE-4471');
    expect(capture.captureMethod).toBe('KEYED_IN');
    expect(capture.capturedBy.value).toBe('OP-001');
  });
});
