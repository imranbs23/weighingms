/**
 * The audit trail's database.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. MONOTONIC. AND THE SEQUENCE IS THE DATABASE'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The `sequence` is `INTEGER PRIMARY KEY AUTOINCREMENT` — so SQLite
 * assigns it under the write lock, and it is **monotonic by
 * construction**. An application-side counter would be racy, and two
 * concurrent privileged actions would be recorded as a **tie** (ADR-043).
 *
 * And `AUTOINCREMENT` rather than a plain rowid, because SQLite's plain
 * rowid **reuses** a deleted maximum — and the story requires the trail to
 * **never silently rewind** across a restore.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '034-create-audit-entries',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE AUDIT TRAIL — one row per PRIVILEGED ACTION.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- THE SEQUENCE IS THE PRIMARY KEY, AND IT IS AUTOINCREMENT.
      --
      -- It is the trail's AUTHORITATIVE order — the timestamp is for human
      -- reading — because two privileged actions can genuinely occur in the
      -- same millisecond, and a timestamp cannot separate them.
      --
      -- And AUTOINCREMENT rather than a plain rowid, because SQLite's plain
      -- rowid REUSES a deleted maximum. The trail must never silently
      -- rewind, even across a restore from an older backup.
      --
      -- THE REASON IS IN CLEAR TEXT. It authorises nothing, and it must be
      -- readable by an auditor five years later — it is a record, not a
      -- credential (ADR-005).
      --
      -- AND THE ACTION IS A CLOSED SET, enforced by a CHECK — derived from
      -- the BRD's own constraints (FR-35, FR-22, FR-28), not from an
      -- invented taxonomy.
      CREATE TABLE IF NOT EXISTS audit_entries (
        sequence     INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id     TEXT NOT NULL UNIQUE,
        action       TEXT NOT NULL CHECK (action IN (
                       'TOLERANCE_OVERRIDE',
                       'MANUAL_SCALE_RESELECTION',
                       'CALIBRATION_BYPASS',
                       'CONFIGURATION_CHANGE',
                       'REPRINT',
                       'TOLERANCE_OVERRIDE_REFUSED',
                       'MANUAL_SCALE_RESELECTION_REFUSED',
                       'CALIBRATION_BYPASS_REFUSED',
                       'CONFIGURATION_CHANGE_REFUSED',
                       'REPRINT_REFUSED'
                     )),
        actor_id     TEXT NOT NULL,
        actor_role   TEXT NOT NULL,
        subject      TEXT NOT NULL,
        reason       TEXT NOT NULL,
        occurred_at  TEXT NOT NULL,
        recorded_at  TEXT NOT NULL
      );

      -- The trail is queried BY ACTOR — the question an auditor asks first.
      CREATE INDEX IF NOT EXISTS idx_audit_entries_actor
        ON audit_entries (actor_id, sequence);

      -- And BY ACTION, and BY TIME — the other two filters.
      CREATE INDEX IF NOT EXISTS idx_audit_entries_action
        ON audit_entries (action, sequence);

      CREATE INDEX IF NOT EXISTS idx_audit_entries_time
        ON audit_entries (occurred_at, sequence);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path in the repository, and these make that true in the
      -- database as well — so a buggy or compromised caller cannot mutate
      -- history (BRD NFR-13, BRD DR-02).
      CREATE TRIGGER IF NOT EXISTS trg_audit_entries_no_update
      BEFORE UPDATE ON audit_entries
      BEGIN
        SELECT RAISE(ABORT, 'audit_entries is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_audit_entries_no_delete
      BEFORE DELETE ON audit_entries
      BEGIN
        SELECT RAISE(ABORT, 'audit_entries is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 */
export function openAuditDatabase(
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
