/**
 * The scale unit's SQLite tables.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO `scale_readings` TABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * That absence is the design (ADR-009). Readings are live-only, and
 * persisting them would risk a stale reading being read back as a live
 * one — the exact confusion the disconnection rule exists to prevent. The
 * only way to persist a weight in this product is to CONFIRM it, and a
 * confirmed weight is a weighing record, which belongs to unit 003.
 *
 * TWO TABLES
 * ----------
 *   scale_devices     — the CONFIGURATION: which scales exist, their
 *                       capability and their calibration. Not status.
 *   scale_link_events — the APPEND-ONLY disconnection gaps.
 *
 * The status is live state and is deliberately NOT persisted: a stale
 * status read back after a restart would be the same failure mode as a
 * stale reading.
 *
 * QUANTITIES ARE TEXT
 * -------------------
 * `capacity` and `resolution` are `TEXT`, not `REAL`. SQLite's `REAL` is
 * an IEEE-754 double, which is exactly what BRD NFR-16 forbids for
 * quantities.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '008-create-scale-devices',
    sql: `
      CREATE TABLE IF NOT EXISTS scale_devices (
        id                      TEXT PRIMARY KEY,
        label                   TEXT NOT NULL,
        class                   TEXT NOT NULL CHECK (class IN ('PRECISION','FLOOR')),
        capacity                TEXT NOT NULL,
        resolution              TEXT NOT NULL,
        unit                    TEXT NOT NULL,
        calibration_state       TEXT NOT NULL CHECK (calibration_state IN ('IN_CALIBRATION','EXPIRED')),
        calibration_expires_at  TEXT
      );
    `,
  },
  {
    id: '009-create-scale-link-events',
    sql: `
      -- The disconnection gap, recorded as TWO immutable facts rather than
      -- one mutable row (S-9). The gap is the PROJECTION of the pair.
      --
      -- occurred_at is when the device stopped being heard from;
      -- detected_at is when the watchdog noticed. They are different
      -- facts, and detected_at - occurred_at IS the detection latency
      -- that IR-13 bounds.
      --
      -- NO WEIGHT IS RECORDED HERE. A gap says "there was no reading
      -- between these two times", which is the durable fact that matters,
      -- without recording a quantity (ADR-009).
      CREATE TABLE IF NOT EXISTS scale_link_events (
        id                    TEXT PRIMARY KEY,
        scale_id              TEXT NOT NULL,
        kind                  TEXT NOT NULL CHECK (kind IN ('STARTED','ENDED')),
        occurred_at           TEXT NOT NULL,
        detected_at           TEXT NOT NULL,
        last_sequence         INTEGER,
        resumed_at_sequence   INTEGER,
        FOREIGN KEY (scale_id) REFERENCES scale_devices(id)
      );
    `,
  },
  {
    id: '010-index-scale-link-events',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_scale_link_events_device
        ON scale_link_events (scale_id, occurred_at);
    `,
  },
];

/**
 * Open (or create) the database and apply the scale unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table
 * the identity unit uses, so the two units can share one database file
 * without either re-applying the other's tables.
 */
export function openScaleDatabase(
  path: string,
  existing?: SqliteDatabase,
): SqliteDatabase {
  if (existing !== undefined) {
    applyMigrations(existing);
    return existing;
  }

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  applyMigrations(db);
  return db;
}

function applyMigrations(db: SqliteDatabase): void {
  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.id} failed: ${(e as Error).message}`,
      );
    }
  }
}
