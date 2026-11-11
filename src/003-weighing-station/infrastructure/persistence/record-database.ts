/**
 * The weighing record's SQLite table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TABLE. APPEND-ONLY. AND THE TRIGGERS ARE THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A weighing record describes something that physically happened, and BRD
 * DR-02 requires that it not be revised. So there is no update path, no
 * delete path, and `BEFORE UPDATE` / `BEFORE DELETE` triggers that abort.
 *
 * **And a correction is a NEW ROW** carrying `corrects_record_id`. The
 * original is untouched (C-12).
 *
 * THE TARGET, THE TOLERANCE AND THE SCALE'S CLASS ARE SNAPSHOTTED
 * -------------------------------------------------------------
 * A later revision in OrgaTEX must not rewrite history (BRD FR-25, BRD
 * BR-14). So the record carries the values **as they were at weighing
 * time** — not a reference to a live recipe.
 *
 * EVERY QUANTITY IS TEXT
 * --------------------
 * BRD NFR-16 and C-11: a quantity is never a float, and a `REAL` column
 * would round it.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '027-create-weighing-records',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE WEIGHING RECORD — the core traceability record.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per confirmed weighing. APPEND-ONLY: the record describes
      -- something that physically happened, and BRD DR-02 requires that
      -- such a record not be revised.
      --
      -- A CORRECTION IS A NEW ROW. corrects_record_id points at the
      -- original, and the original is untouched (C-12).
      --
      -- THE TARGET, THE TOLERANCE AND THE SCALE'S CLASS ARE SNAPSHOTTED.
      -- A later revision in OrgaTEX must not rewrite history (BRD FR-25,
      -- BRD BR-14) — so the record carries the values as they were at
      -- weighing time.
      --
      -- EVERY QUANTITY IS TEXT. A REAL column would round it (NFR-16).
      CREATE TABLE IF NOT EXISTS weighing_records (
        record_id            TEXT NOT NULL PRIMARY KEY,
        session_id           TEXT NOT NULL,
        component_id         TEXT NOT NULL,
        actual_quantity      TEXT NOT NULL,
        unit                 TEXT NOT NULL,
        target_at_weighing   TEXT NOT NULL,
        tolerance_at_weighing TEXT NULL,
        zone_at_confirm      TEXT NOT NULL CHECK (zone_at_confirm IN ('OVER','OK','NEAR','UNDER')),
        scale_id             TEXT NOT NULL,
        scale_class          TEXT NOT NULL,
        lot_number           TEXT NULL,
        container_id         TEXT NULL,
        operator_id          TEXT NOT NULL,
        weighed_at           TEXT NOT NULL,
        recorded_at          TEXT NOT NULL,
        corrects_record_id   TEXT NULL
      );

      -- ONE CONFIRMATION PER COMPONENT PER SESSION.
      --
      -- The duplicate is refused ATOMICALLY, by the database and not by a
      -- check-then-write — because a check-then-write is racy under
      -- concurrency, and the race is exactly the case the story names:
      -- "two confirmations for the same component arrive concurrently →
      -- only one record is written; the second is refused as a duplicate"
      -- (ADR-040).
      --
      -- And this is the SAME argument as ADR-006's idempotency ledger: the
      -- constraint is the guarantee, not the existence check.
      --
      -- THE CORRECTION IS EXEMPT. A correction is a NEW record that
      -- references the original (C-12), so it must not collide with the
      -- original's row — and a partial UNIQUE index says exactly that:
      -- the constraint applies to a row that is NOT a correction, and a
      -- correction is free to exist beside it.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_weighing_records_confirmation
        ON weighing_records (session_id, component_id)
        WHERE corrects_record_id IS NULL;

      -- The effective record for a component in a session. A TOTAL order —
      -- weighed_at alone is ambiguous when two rows land in the same
      -- millisecond, and "the latest" must have exactly one answer.
      CREATE INDEX IF NOT EXISTS idx_weighing_records_component
        ON weighing_records (session_id, component_id, weighed_at DESC);

      -- The lot's own history, across every weighing. This is the query a
      -- shade failure asks: which weighings used this lot?
      CREATE INDEX IF NOT EXISTS idx_weighing_records_lot
        ON weighing_records (lot_number);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path, and these make that true in the database as well as in
      -- the repository.
      CREATE TRIGGER IF NOT EXISTS trg_weighing_records_no_update
      BEFORE UPDATE ON weighing_records
      BEGIN
        SELECT RAISE(ABORT, 'weighing_records is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_weighing_records_no_delete
      BEFORE DELETE ON weighing_records
      BEGIN
        SELECT RAISE(ABORT, 'weighing_records is append-only');
      END;
    `,
  },
  {
    id: '037-weighing-records-carry-tare',
    sql: `
      -- THE RECORD CARRIES ITS TARE (bolt 032, ADR-048).
      --
      -- Nullable columns, added without rewriting a row: the no-update and
      -- no-delete triggers stay, and a record written before this reads
      -- back with no tare — which is the truth. Nothing is back-filled.
      ALTER TABLE weighing_records ADD COLUMN tare_weight TEXT NULL;
      ALTER TABLE weighing_records ADD COLUMN tare_unit TEXT NULL;
      ALTER TABLE weighing_records ADD COLUMN tare_source TEXT NULL
        CHECK (tare_source IS NULL OR tare_source IN ('CONTAINER_MASTER','WEIGHED_EMPTY_CONTAINER'));
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table the
 * other units use, so all the units can share one database file.
 */
export function openRecordDatabase(
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
