/**
 * The override record's SQLite table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TABLE. APPEND-ONLY. AND THE REASON IS IN CLEAR TEXT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The record describes something that physically happened — a supervisor
 * authorised an out-of-tolerance weighing — and BRD DR-02 requires that it
 * not be revised. So there is no update path, no delete path, and
 * `BEFORE UPDATE` / `BEFORE DELETE` triggers that abort.
 *
 * **AND THE REASON IS STORED VERBATIM.** Unit `008`'s ADR-005 settled it
 * for the authorisation's reason: *"it must be readable by an auditor five
 * years later — it is a record, not a credential."* The same reasoning
 * applies here, and the reason is the whole point of the record.
 *
 * EVERY QUANTITY IS TEXT
 * --------------------
 * BRD NFR-16: a quantity is never a float, and a `REAL` column would round
 * it.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '029-create-override-records',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE OVERRIDE RECORD — a supervisor's authorised exception.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per authorised exception. APPEND-ONLY: the record
      -- describes something that physically happened, and BRD DR-02 requires
      -- that such a record not be revised.
      --
      -- THE REASON IS IN CLEAR TEXT. It must be readable by an auditor five
      -- years later — it is a record, not a credential (ADR-005).
      --
      -- THE QUANTITY IS TEXT. A REAL column would round it (NFR-16).
      CREATE TABLE IF NOT EXISTS override_records (
        record_id        TEXT NOT NULL PRIMARY KEY,
        authorisation_id TEXT NOT NULL,
        supervisor_id    TEXT NOT NULL,
        operator_id      TEXT NOT NULL,
        reason           TEXT NOT NULL,
        component_id     TEXT NOT NULL,
        session_id       TEXT NOT NULL,
        surplus_amount   TEXT NOT NULL,
        surplus_unit     TEXT NOT NULL,
        authorised_at    TEXT NOT NULL,
        recorded_at      TEXT NOT NULL
      );

      -- The effective record for a component — the newest row. The ordering
      -- is by the INSERTION SEQUENCE's absence and recorded_at, which is
      -- sufficient here because one component is overridden once per
      -- weighing.
      CREATE INDEX IF NOT EXISTS idx_override_records_component
        ON override_records (component_id, authorised_at DESC);

      -- The lot's own history — no. The SUPERVISOR's history: every
      -- exception this supervisor authorised, across every component.
      CREATE INDEX IF NOT EXISTS idx_override_records_supervisor
        ON override_records (supervisor_id, authorised_at DESC);

      -- THE TRIGGERS ARE THE ENFORCEMENT.
      CREATE TRIGGER IF NOT EXISTS trg_override_records_no_update
      BEFORE UPDATE ON override_records
      BEGIN
        SELECT RAISE(ABORT, 'override_records is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_override_records_no_delete
      BEFORE DELETE ON override_records
      BEGIN
        SELECT RAISE(ABORT, 'override_records is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 */
export function openOverrideDatabase(
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
