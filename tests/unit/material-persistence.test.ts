/**
 * The material identity's and the lot capture's persistence.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE APPEND-ONLY PROPERTY IS ENFORCED BY THE DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A repository with no update method is a **convention**. A trigger that
 * ABORTS is a **guarantee** — it holds against a migration script, a
 * repair script, and any future unit that decides to write here
 * (ADR-029, ADR-034).
 *
 * And the closed sets are in the storage layer too, so a third method
 * cannot be written even by a path that bypasses the domain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  ComponentId,
  DyestuffCode,
  LotNumber,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { MaterialIdentity } from '../../src/002-recipe-material-management/domain/entities/material-identity.js';
import { MaterialLotCapture } from '../../src/002-recipe-material-management/domain/entities/material-lot-capture.js';
import { AttestedClaims } from '../../src/002-recipe-material-management/domain/value-objects/attested-claims.js';
import {
  openMaterialDatabase,
  type SqliteDatabase,
} from '../../src/002-recipe-material-management/infrastructure/persistence/material-database.js';
import {
  SqliteMaterialIdentityRepository,
} from '../../src/002-recipe-material-management/infrastructure/persistence/sqlite-material-identity-repository.js';
import {
  SqliteMaterialLotRepository,
} from '../../src/002-recipe-material-management/infrastructure/persistence/sqlite-material-lot-repository.js';

const AT = Instant.of(new Date('2026-11-06T08:14:22.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const COMPONENT = ComponentId.create('DYE-4471-Y');

describe('the material identity and lot persistence', () => {
  let db: SqliteDatabase;
  let identities: SqliteMaterialIdentityRepository;
  let lots: SqliteMaterialLotRepository;

  beforeEach(() => {
    db = openMaterialDatabase(':memory:');
    identities = new SqliteMaterialIdentityRepository(db);
    lots = new SqliteMaterialLotRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function scannedIdentity(barcode: string): MaterialIdentity {
    return new MaterialIdentity(
      COMPONENT,
      DyestuffCode.create('DYE-4471'),
      'SCAN',
      OPERATOR,
      AT,
      barcode,
      null,
    );
  }

  function attestedIdentity(): MaterialIdentity {
    return new MaterialIdentity(
      COMPONENT,
      DyestuffCode.create('DYE-4471'),
      'ATTESTATION',
      OPERATOR,
      AT,
      null,
      AttestedClaims.dyestuffCode(),
    );
  }

  function capture(lot: string, method: 'SOURCE' | 'SCAN' | 'KEYED_IN') {
    return new MaterialLotCapture(
      COMPONENT,
      LotNumber.create(lot),
      DyestuffCode.create('DYE-4471'),
      method,
      OPERATOR,
      AT,
    );
  }

  // ── The round trip ──

  it('reads a scan back with every field', async () => {
    await identities.save(scannedIdentity('DYE-4471'));

    const read = await identities.latestFor(COMPONENT);
    expect(read?.verifiedBy).toBe('SCAN');
    expect(read?.barcode).toBe('DYE-4471');
    expect(read?.attestedClaims).toBeNull();
    expect(read?.operatorId.value).toBe('OP-001');
  });

  it('reads an attestation back with its claims', async () => {
    await identities.save(attestedIdentity());

    const read = await identities.latestFor(COMPONENT);
    expect(read?.verifiedBy).toBe('ATTESTATION');
    expect(read?.barcode).toBeNull();
    expect(read?.attestedClaims?.values).toEqual(['dyestuffCode']);
  });

  it('reads a capture back with every field', async () => {
    await lots.save(capture('2026-0387', 'KEYED_IN'));

    const read = await lots.latestFor(COMPONENT);
    expect(read?.lotNumber.value).toBe('2026-0387');
    expect(read?.captureMethod).toBe('KEYED_IN');
    expect(read?.materialCode.value).toBe('DYE-4471');
    expect(read?.capturedBy.value).toBe('OP-001');
  });

  it('is null when nothing has been recorded', async () => {
    expect(await identities.latestFor(COMPONENT)).toBeNull();
    expect(await lots.latestFor(COMPONENT)).toBeNull();
  });

  // ── The append-only property ──

  it('refuses an UPDATE on the identities', async () => {
    await identities.save(scannedIdentity('DYE-4471'));

    expect(() =>
      db
        .prepare(
          `UPDATE material_identities SET barcode = 'TAMPERED' WHERE component_id = ?`,
        )
        .run(COMPONENT.value),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE on the identities', async () => {
    await identities.save(scannedIdentity('DYE-4471'));

    expect(() =>
      db.prepare(`DELETE FROM material_identities`).run(),
    ).toThrow(/append-only/);
  });

  it('refuses an UPDATE on the lot captures', async () => {
    await lots.save(capture('2026-0387', 'KEYED_IN'));

    expect(() =>
      db
        .prepare(`UPDATE material_lot_captures SET lot_number = 'TAMPERED'`)
        .run(),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE on the lot captures', async () => {
    await lots.save(capture('2026-0387', 'KEYED_IN'));

    expect(() =>
      db.prepare(`DELETE FROM material_lot_captures`).run(),
    ).toThrow(/append-only/);
  });

  // ── The closed sets, in the storage layer ──

  it('refuses a THIRD verification method', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO material_identities
             (component_id, material_code, verified_by, operator_id,
              verified_at, barcode, attested_claims, recorded_at)
           VALUES (?, ?, 'GUESSED', ?, ?, ?, NULL, ?)`,
        )
        .run(
          COMPONENT.value,
          'DYE-4471',
          OPERATOR.value,
          AT.toString(),
          'DYE-4471',
          AT.toString(),
        ),
    ).toThrow();
  });

  it('refuses a THIRD capture method', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO material_lot_captures
             (component_id, lot_number, material_code,
              capture_method, captured_by, captured_at, recorded_at)
           VALUES (?, ?, ?, 'GUESSED', ?, ?, ?)`,
        )
        .run(
          COMPONENT.value,
          '2026-0387',
          'DYE-4471',
          OPERATOR.value,
          AT.toString(),
          AT.toString(),
        ),
    ).toThrow();
  });

  it('refuses a row carrying BOTH a barcode and claims', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO material_identities
             (component_id, material_code, verified_by, operator_id,
              verified_at, barcode, attested_claims, recorded_at)
           VALUES (?, ?, 'SCAN', ?, ?, ?, 'dyestuffCode', ?)`,
        )
        .run(
          COMPONENT.value,
          'DYE-4471',
          OPERATOR.value,
          AT.toString(),
          'DYE-4471',
          AT.toString(),
        ),
    ).toThrow();
  });

  // ── The newest row is the effective one ──

  it('the newest capture is the effective one, and the older is RETAINED', async () => {
    await lots.save(capture('FIRST', 'KEYED_IN'));
    await lots.save(capture('SECOND', 'KEYED_IN'));

    const read = await lots.latestFor(COMPONENT);
    expect(read?.lotNumber.value).toBe('SECOND');

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM material_lot_captures`)
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('the same lot for two components is NOT de-duplicated', async () => {
    await lots.save(capture('2026-0387', 'KEYED_IN'));
    await lots.save(
      new MaterialLotCapture(
        ComponentId.create('DYE-4471-B'),
        LotNumber.create('2026-0387'),
        DyestuffCode.create('DYE-1180'),
        'KEYED_IN',
        OPERATOR,
        AT,
      ),
    );

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM material_lot_captures`)
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('the insertion sequence breaks the tie when two rows land together', async () => {
    await identities.save(scannedIdentity('FIRST'));
    await identities.save(scannedIdentity('SECOND'));

    const read = await identities.latestFor(COMPONENT);
    // Both have the SAME `verified_at`, so the id is what decides — and it
    // decides in the order the acts happened.
    expect(read?.barcode).toBe('SECOND');
  });
});
