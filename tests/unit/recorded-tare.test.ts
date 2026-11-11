/**
 * The tare on the weighing record — unit 003, bolt 032 (ADR-048).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RECORD CARRIES THE TARE IT USED. AN OLD RECORD CARRIES NONE.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../src/003-weighing-station/domain/entities/weighing-record.js';
import {
  isRecordedTareSource,
  type RecordedTare,
} from '../../src/003-weighing-station/domain/value-objects/recorded-tare.js';
import {
  openRecordDatabase,
  type SqliteDatabase,
} from '../../src/003-weighing-station/infrastructure/persistence/record-database.js';
import { SqliteWeighingRecordRepository } from '../../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-record-repository.js';

const COMPONENT = ComponentId.create('DYE-4471-Y');

function record(
  containerId: string | null,
  tare: RecordedTare | null,
  id = 'REC-1',
): WeighingRecord {
  return new WeighingRecord(
    id,
    'WS-1',
    COMPONENT,
    WeightValue.of('94.2400', 'g'),
    WeightValue.of('94.0000', 'g'),
    Tolerance.of(WeightValue.of('93.5000', 'g'), WeightValue.of('94.5000', 'g')),
    'OK',
    ScaleId.create('SCALE-A'),
    'PRECISION',
    '2026-0387',
    containerId,
    OperatorId.create('OP-001'),
    Instant.of(new Date('2026-11-11T09:14:22.000Z')),
    null,
    tare,
  );
}

describe('the recorded tare', () => {
  let db: SqliteDatabase | null = null;
  let dir: string | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('knows its two sources, and nothing else', () => {
    expect(isRecordedTareSource('CONTAINER_MASTER')).toBe(true);
    expect(isRecordedTareSource('WEIGHED_EMPTY_CONTAINER')).toBe(true);
    expect(isRecordedTareSource('DEVICE_ZERO')).toBe(false);
    expect(isRecordedTareSource(null)).toBe(false);
  });

  it('round-trips a tare — weight, unit and source, as strings', async () => {
    db = openRecordDatabase(':memory:');
    const records = new SqliteWeighingRecordRepository(db);
    await records.save(
      record('C-12', { weight: WeightValue.of('214.0000', 'g'), source: 'CONTAINER_MASTER' }),
    );

    const read = await records.latestFor('WS-1', COMPONENT);
    expect(read?.containerId).toBe('C-12');
    expect(read?.tare?.weight.text).toBe('214.0000');
    expect(read?.tare?.weight.unit).toBe('g');
    expect(read?.tare?.source).toBe('CONTAINER_MASTER');
  });

  it('round-trips NO tare as null — never a zero', async () => {
    db = openRecordDatabase(':memory:');
    const records = new SqliteWeighingRecordRepository(db);
    await records.save(record(null, null));

    const read = await records.latestFor('WS-1', COMPONENT);
    expect(read?.containerId).toBeNull();
    expect(read?.tare).toBeNull();
  });

  it('the database refuses a tare source it does not know', () => {
    db = openRecordDatabase(':memory:');
    expect(() =>
      db!
        .prepare(
          `INSERT INTO weighing_records
             (record_id, session_id, component_id, actual_quantity, unit,
              target_at_weighing, zone_at_confirm, scale_id, scale_class,
              operator_id, weighed_at, recorded_at, tare_weight, tare_unit, tare_source)
           VALUES ('R', 'WS-1', 'C', '1', 'g', '1', 'OK', 'S', 'PRECISION',
                   'OP-001', 'now', 'now', '1', 'g', 'GUESSED')`,
        )
        .run(),
    ).toThrow();
  });

  it('a record written BEFORE migration 037 reads back with tare null — nothing is back-filled', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wms-tare-'));
    const file = join(dir, 'records.sqlite');

    // THE OLD SHAPE: the table as it was before 037, and a row written then.
    const old = openRecordDatabase(file);
    old.exec(`
      ALTER TABLE weighing_records DROP COLUMN tare_source;
      ALTER TABLE weighing_records DROP COLUMN tare_unit;
      ALTER TABLE weighing_records DROP COLUMN tare_weight;
      DELETE FROM schema_migrations WHERE id = '037-weighing-records-carry-tare';
    `);
    old
      .prepare(
        `INSERT INTO weighing_records
           (record_id, session_id, component_id, actual_quantity, unit,
            target_at_weighing, zone_at_confirm, scale_id, scale_class,
            container_id, operator_id, weighed_at, recorded_at)
         VALUES ('OLD-1', 'WS-1', 'DYE-4471-Y', '94.2400', 'g', '94.0000', 'OK',
                 'SCALE-A', 'PRECISION', 'C-12', 'OP-001',
                 '2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z')`,
      )
      .run();
    old.close();

    // REOPEN — migration 037 runs for real on the existing table.
    db = openRecordDatabase(file);
    const read = await new SqliteWeighingRecordRepository(db).latestFor('WS-1', COMPONENT);

    expect(read?.recordId).toBe('OLD-1');
    expect(read?.containerId).toBe('C-12');
    expect(read?.tare).toBeNull();
    const migrated = db
      .prepare("SELECT id FROM schema_migrations WHERE id = '037-weighing-records-carry-tare'")
      .all();
    expect(migrated).toHaveLength(1);
  });
});
