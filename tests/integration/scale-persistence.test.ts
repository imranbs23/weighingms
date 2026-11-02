/**
 * Integration tests for the scale unit's persistence.
 *
 * WHAT IS PROVED HERE
 * --------------------
 *   ADR-009  there is NO table that stores a weight
 *   S-9      a gap is two append-only facts, and nothing updates them
 *   NFR-16   the quantities are TEXT, never REAL
 *
 * THE ABSENCE OF A TABLE IS TESTED
 * --------------------------------
 * "There is no readings table" is a claim about the SCHEMA, so it is
 * checked against the schema — not against a comment, and not by
 * inspecting the repository's methods.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  openScaleDatabase,
  type SqliteDatabase,
} from '../../src/004-scale-integration/infrastructure/persistence/scale-database.js';
import { SqliteScaleDeviceRepository } from '../../src/004-scale-integration/infrastructure/persistence/sqlite-scale-device-repository.js';
import { SqliteDeviceLinkHistoryRepository } from '../../src/004-scale-integration/infrastructure/persistence/sqlite-device-link-history-repository.js';
import { ScaleDevice } from '../../src/004-scale-integration/domain/entities/scale-device.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleCapability } from '../../src/004-scale-integration/domain/value-objects/scale-capability.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
import { DisconnectionStarted } from '../../src/004-scale-integration/domain/entities/disconnection-started.js';
import { DisconnectionEnded } from '../../src/004-scale-integration/domain/entities/disconnection-ended.js';

const ID = ScaleId.create('SCALE-A');
const AT = new Date('2026-10-30T07:00:00.000Z');

function device(): ScaleDevice {
  return new ScaleDevice(
    ID,
    '3 kg precision',
    new ScaleCapability(
      'PRECISION',
      WeightValue.of('3000', 'g'),
      WeightValue.of('1', 'g'),
    ),
    { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01T00:00:00.000Z') },
    AT,
  );
}

describe('Scale persistence', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openScaleDatabase(':memory:');
    // The link events reference the device, so the device row must
    // exist first — the foreign key is enforced.
    await new SqliteScaleDeviceRepository(db).save(device());
  });

  afterEach(() => {
    db.close();
  });

  it('creates the device and link-event tables', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain('scale_devices');
    expect(tables).toContain('scale_link_events');
  });

  it('HAS NO TABLE THAT STORES A WEIGHT — ADR-009', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    // No table in this schema may hold a reading. The weight of a
    // weighing is recorded by unit 003 as a CONFIRMED weighing, not by
    // this unit.
    const weightTables = tables.filter((name) =>
      /reading|weight|measurement/i.test(name),
    );
    expect(weightTables).toEqual([]);
  });

  it('has no column that could hold a weight', () => {
    for (const table of ['scale_devices', 'scale_link_events']) {
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => (row as { name: string }).name);

      const weightColumns = columns.filter((name) =>
        /weight|reading|value|quantity/i.test(name),
      );
      expect(weightColumns).toEqual([]);
    }
  });

  it('stores the quantities as TEXT, never REAL — NFR-16', () => {
    const columns = db
      .prepare('PRAGMA table_info(scale_devices)')
      .all()
      .map((row) => ({
        name: (row as { name: string }).name,
        type: (row as { type: string }).type,
      }));

    const capacity = columns.find((c) => c.name === 'capacity');
    expect(capacity?.type).toBe('TEXT');

    const resolution = columns.find((c) => c.name === 'resolution');
    expect(resolution?.type).toBe('TEXT');
  });

  it('round-trips a device through the repository', async () => {
    const repository = new SqliteScaleDeviceRepository(db);
    await repository.save(device());

    const found = await repository.get(ID);
    expect(found).not.toBeNull();
    expect(found?.label).toBe('3 kg precision');
    expect(found?.capability.capacity.text).toBe('3000');
    expect(found?.capability.resolution.text).toBe('1');
    expect(found?.capability.capacity.unit).toBe('g');
    expect(found?.calibrationState.kind).toBe('IN_CALIBRATION');
  });

  it('lists the registered devices', async () => {
    const repository = new SqliteScaleDeviceRepository(db);
    await repository.save(device());

    const all = await repository.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id.value).toBe('SCALE-A');
  });

  it('does not persist the STATUS — it is live state', async () => {
    const repository = new SqliteScaleDeviceRepository(db);
    await repository.save(device());

    const columns = db
      .prepare('PRAGMA table_info(scale_devices)')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).not.toContain('status');
    expect(columns).not.toContain('link_state');
  });

  it('appends a disconnection gap as TWO facts', async () => {
    const history = new SqliteDeviceLinkHistoryRepository(db);

    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(42),
        'SILENCE',
      ),
    );
    await history.appendEnded(
      new DisconnectionEnded(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:01:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(43),
      ),
    );

    const gaps = await history.listGaps(ID);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.ended).not.toBeNull();
    expect(gaps[0]?.started.startedAt.toISOString()).toBe(
      '2026-10-30T07:00:00.000Z',
    );
    expect(gaps[0]?.ended?.endedAt.toISOString()).toBe(
      '2026-10-30T07:01:00.000Z',
    );
  });

  it('records the detection latency — the two times are different facts', async () => {
    const history = new SqliteDeviceLinkHistoryRepository(db);

    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(42),
        'SILENCE',
      ),
    );

    const rows = db
      .prepare('SELECT occurred_at, detected_at FROM scale_link_events')
      .all() as unknown as { occurred_at: string; detected_at: string }[];

    expect(rows[0]?.occurred_at).not.toBe(rows[0]?.detected_at);
  });

  it('leaves an OPEN gap with no end when the device has not returned', async () => {
    const history = new SqliteDeviceLinkHistoryRepository(db);

    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(42),
        'SILENCE',
      ),
    );

    const gaps = await history.listGaps(ID);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.ended).toBeNull();
  });

  it('is APPEND-ONLY — a recorded gap is never modified', async () => {
    const history = new SqliteDeviceLinkHistoryRepository(db);

    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(42),
        'SILENCE',
      ),
    );

    const before = db
      .prepare('SELECT * FROM scale_link_events')
      .all();

    // There is no update path — the repository exposes only appends and
    // a read. Appending again ADDS; it does not replace.
    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T08:00:00.000Z'),
        new Date('2026-10-30T08:00:02.000Z'),
        ReadingSequence.of(43),
        'SILENCE',
      ),
    );

    const after = db
      .prepare('SELECT * FROM scale_link_events')
      .all();

    expect(after.length).toBe(before.length + 1);
    expect(after[0]).toEqual(before[0]);
  });

  it('records NO weight in the gap facts', async () => {
    const history = new SqliteDeviceLinkHistoryRepository(db);

    await history.appendStarted(
      new DisconnectionStarted(
        ID,
        new Date('2026-10-30T07:00:00.000Z'),
        new Date('2026-10-30T07:00:02.000Z'),
        ReadingSequence.of(42),
        'SILENCE',
      ),
    );

    const rows = db.prepare('SELECT * FROM scale_link_events').all();
    expect(JSON.stringify(rows)).not.toContain('weight');
  });
});
