/**
 * The weighing session's SQLite table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TABLE. MUTABLE. AND THE MUTABILITY IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The session is the station's **live state** — the MES has no idea where
 * the operator got to, and it cannot be re-derived — so it is persisted so
 * the work can be resumed after an interruption (NFR-06, invariant 7).
 *
 * **And it is MUTABLE**, because it is not a record of a completed act. The
 * `WeighingRecord` is that, it is immutable, and it is a different table
 * (bolt `017`). The distinction is the one ADR-036 makes: **the live state
 * is maintained; the record of a completed act is not.**
 *
 * THE WEIGHT IS TEXT, NEVER REAL
 * ----------------------------
 * BRD NFR-16: a quantity is never a float. A `REAL` column would round it,
 * and the weight is the number the operator is dispensing against.
 *
 * THE LAST ACCEPTED SEQUENCE IS PERSISTED
 * --------------------------------------
 * So the out-of-order guard **survives a restart**. A reading replayed
 * after a restart is still rejected — rather than being accepted because
 * the in-memory floor was lost with the process (ADR-036).
 *
 * THE STALE FLAG
 * --------------
 * When the scale goes away, the last known weight is **retained for
 * display and marked stale**. The operator can still see what the scale
 * last said, and the UI can mark it as old (BRD IR-13).
 *
 * AND THE STATE'S CLOSED SET IS IN THE STORAGE LAYER
 * -------------------------------------------------
 * A ninth state cannot be written even by a path that bypasses the domain.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '026-create-weighing-sessions',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE SESSION — the station's LIVE state of work in progress.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- This table is MUTABLE, and that is deliberate. The session's value
      -- is NOW — it is not the record of a completed act. The
      -- WeighingRecord is that, it is immutable, and it is a different
      -- table (ADR-036).
      --
      -- It is persisted because the session is the station's own state and
      -- cannot be re-derived: the MES has no idea which component the
      -- operator got to. The work must be RESUMABLE after an interruption
      -- (NFR-06, invariant 7).
      --
      -- NO QUANTITY OF ANYBODY ELSE'S TRUTH IS HERE. The target, the
      -- tolerance and the scale class belong to the recipe; the tare
      -- belongs to the device. The session holds only the live facts: which
      -- component, which scale, what the scale last said (ADR-036).
      --
      -- THE LAST ACCEPTED SEQUENCE IS PERSISTED so the out-of-order guard
      -- survives a restart — a replayed reading is still rejected.
      CREATE TABLE IF NOT EXISTS weighing_sessions (
        session_id          TEXT NOT NULL PRIMARY KEY,
        batch_id           TEXT NOT NULL,
        operator_id        TEXT NOT NULL,
        state              TEXT NOT NULL CHECK (state IN (
                            'AWAITING_BATCH','AWAITING_COMPONENT','WEIGHING',
                            'COMPENSATING','ESCALATED','CONFIRMING','COMPLETE')),
        active_component_id TEXT NULL,
        selected_scale_id  TEXT NULL,
        current_weight     TEXT NULL,
        weight_unit        TEXT NULL,
        weight_stable      INTEGER NULL,
        weight_stale       INTEGER NOT NULL DEFAULT 0,
        weight_sequence    INTEGER NULL,
        components_json    TEXT NOT NULL,
        component_unit     TEXT NULL,
        started_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table the
 * other units use, so all the units can share one database file.
 */
export function openSessionDatabase(
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
