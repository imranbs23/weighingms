/**
 * The weighing record's persistence — unit 003, bolt 014.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RECORD IS IMMUTABLE, AND THE DATABASE SAYS SO.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A weighing record describes something that physically happened, and BRD
 * DR-02 requires that it not be revised. So the triggers refuse an `UPDATE`
 * and a `DELETE` — and a **correction is a new row** carrying
 * `corrects_record_id`, with the original untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import {
  ComponentId,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../src/003-weighing-station/domain/entities/weighing-record.js';
import {
  openRecordDatabase,
  type SqliteDatabase,
} from '../../src/003-weighing-station/infrastructure/persistence/record-database.js';
import {
  SqliteWeighingRecordRepository,
} from '../../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-record-repository.js';

const AT = Instant.of(new Date('2026-11-06T09:14:22.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const COMPONENT = ComponentId.create('DYE-4471-Y');

describe('the weighing record persistence', () => {
  let db: SqliteDatabase;
  let records: SqliteWeighingRecordRepository;

  beforeEach(() => {
    db = openRecordDatabase(':memory:');
    records = new SqliteWeighingRecordRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function record(
    id = 'REC-1',
    lot: string | null = '2026-0387',
    corrects: string | null = null,
  ): WeighingRecord {
    return new WeighingRecord(
      id,
      'WS-1',
      COMPONENT,
      WeightValue.of('94.2400', 'g'),
      WeightValue.of('94.0000', 'g'),
      Tolerance.of(
        WeightValue.of('93.5000', 'g'),
        WeightValue.of('94.5000', 'g'),
      ),
      'OK',
      ScaleId.create('SCALE-A'),
      'PRECISION',
      lot,
      'C-12',
      OPERATOR,
      AT,
      corrects,
    );
  }

  it('is null when nothing has been confirmed', async () => {
    expect(await records.latestFor('WS-1', COMPONENT)).toBeNull();
  });

  it('round-trips the traceability set', async () => {
    await records.save(record());

    const read = await records.latestFor('WS-1', COMPONENT);
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(read.actualQuantity.text).toBe('94.2400');
    expect(read.actualQuantity.unit).toBe('g');
    expect(read.targetAtWeighing.text).toBe('94.0000');
    expect(read.toleranceAtWeighing?.min.text).toBe('93.5000');
    expect(read.toleranceAtWeighing?.max.text).toBe('94.5000');
    expect(read.zoneAtConfirm).toBe('OK');
    expect(read.scaleId.value).toBe('SCALE-A');
    expect(read.scaleClass).toBe('PRECISION');
    expect(read.lotNumber).toBe('2026-0387');
    expect(read.containerId).toBe('C-12');
    expect(read.operatorId.value).toBe('OP-001');
  });

  it('refuses an UPDATE — the record is immutable', async () => {
    await records.save(record());

    expect(() =>
      db
        .prepare(`UPDATE weighing_records SET actual_quantity = '0.0000'`)
        .run(),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE — the record is immutable', async () => {
    await records.save(record());

    expect(() =>
      db.prepare(`DELETE FROM weighing_records`).run(),
    ).toThrow(/append-only/);
  });

  it('a DUPLICATE confirmation is refused ATOMICALLY by the constraint', async () => {
    // The duplicate is refused by the database and NOT by a
    // check-then-write — because a check-then-write is racy under
    // concurrency, and the race is exactly the case the story names
    // (ADR-040).
    await records.save(record('REC-1'));

    await expect(records.save(record('REC-2'))).rejects.toThrow(/UNIQUE/);
  });

  it('a CORRECTION is a new row — the original is untouched', async () => {
    await records.save(record('REC-1'));
    await records.save(record('REC-2', '2026-0400', 'REC-1'));

    const original = db
      .prepare(`SELECT actual_quantity FROM weighing_records WHERE record_id = 'REC-1'`)
      .get() as { actual_quantity: string };
    expect(original.actual_quantity).toBe('94.2400');

    const correction = db
      .prepare(`SELECT corrects_record_id FROM weighing_records WHERE record_id = 'REC-2'`)
      .get() as { corrects_record_id: string };
    expect(correction.corrects_record_id).toBe('REC-1');
  });

  it('every quantity is stored as TEXT — never a float', async () => {
    await records.save(record());

    const row = db
      .prepare(
        `SELECT actual_quantity, target_at_weighing FROM weighing_records`,
      )
      .get() as { actual_quantity: unknown; target_at_weighing: unknown };

    expect(typeof row.actual_quantity).toBe('string');
    expect(typeof row.target_at_weighing).toBe('string');
    expect(row.actual_quantity).toBe('94.2400');
  });

  it('refuses a zone outside the closed set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO weighing_records
             (record_id, session_id, component_id, actual_quantity, unit,
              target_at_weighing, tolerance_at_weighing, zone_at_confirm,
              scale_id, scale_class, lot_number, container_id, operator_id,
              weighed_at, recorded_at, corrects_record_id)
           VALUES ('REC-9', 'WS-1', 'C-1', '1.0000', 'g', '1.0000', NULL,
                   'GHOST', 'SCALE-A', 'PRECISION', NULL, NULL, 'OP-1', ?, ?, NULL)`,
        )
        .run(AT.toString(), AT.toString()),
    ).toThrow();
  });

  it('reports whether a component has been confirmed — the idempotence check', async () => {
    expect(await records.existsFor('WS-1', COMPONENT)).toBe(false);
    await records.save(record());
    expect(await records.existsFor('WS-1', COMPONENT)).toBe(true);
  });
});
