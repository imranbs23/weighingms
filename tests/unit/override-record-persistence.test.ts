/**
 * The override record's persistence — unit 003, bolt 016.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE REASON IS IN CLEAR TEXT, AND THE RECORD IS IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OverrideRecord } from '../../src/003-weighing-station/domain/entities/override-record.js';
import {
  openOverrideDatabase,
  type SqliteDatabase,
} from '../../src/003-weighing-station/infrastructure/persistence/override-database.js';
import {
  SqliteOverrideRecordRepository,
} from '../../src/003-weighing-station/infrastructure/persistence/sqlite-override-record-repository.js';

const AT = Instant.of(new Date('2026-11-06T09:41:07.000Z'));
const COMPONENT = ComponentId.create('DYE-4471-Y');

describe('the override record persistence', () => {
  let db: SqliteDatabase;
  let overrides: SqliteOverrideRecordRepository;

  beforeEach(() => {
    db = openOverrideDatabase(':memory:');
    overrides = new SqliteOverrideRecordRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function record(): OverrideRecord {
    return new OverrideRecord(
      'REC-1',
      'AUTH-1',
      'OP-SUP-001',
      'OP-001',
      'the client accepted the excess',
      'DYE-4471-Y',
      'WS-1',
      WeightValue.of('2.4000', 'g'),
      AT,
    );
  }

  it('is null when no override has been recorded', async () => {
    expect(await overrides.latestFor(COMPONENT)).toBeNull();
  });

  it('round-trips the traceability set', async () => {
    await overrides.save(record());

    const read = await overrides.latestFor(COMPONENT);
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(read.authorisationId).toBe('AUTH-1');
    expect(read.supervisorId).toBe('OP-SUP-001');
    expect(read.operatorId).toBe('OP-001');
    expect(read.componentId).toBe('DYE-4471-Y');
    expect(read.sessionId).toBe('WS-1');
    expect(read.surplusAmount.text).toBe('2.4000');
    expect(read.surplusAmount.unit).toBe('g');
  });

  it('the reason is stored in CLEAR TEXT — it is a record, not a credential', async () => {
    await overrides.save(record());

    const row = db
      .prepare(`SELECT reason FROM override_records`)
      .get() as { reason: string };

    // ADR-005: an auditor five years later must be able to READ it.
    expect(row.reason).toBe('the client accepted the excess');
  });

  it('the surplus is stored as TEXT — never a float', async () => {
    await overrides.save(record());

    const row = db
      .prepare(`SELECT surplus_amount FROM override_records`)
      .get() as { surplus_amount: unknown };

    expect(typeof row.surplus_amount).toBe('string');
    expect(row.surplus_amount).toBe('2.4000');
  });

  it('refuses an UPDATE — the record is immutable', async () => {
    await overrides.save(record());

    expect(() =>
      db.prepare(`UPDATE override_records SET reason = 'TAMPERED'`).run(),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE — the record is immutable', async () => {
    await overrides.save(record());

    expect(() =>
      db.prepare(`DELETE FROM override_records`).run(),
    ).toThrow(/append-only/);
  });
});
