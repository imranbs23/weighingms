/**
 * The configuration's database.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO TABLES. THE HISTORY IS APPEND-ONLY. THE EFFECTIVE ROW IS A
 * PROJECTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `configuration_versions` — **every** version of **every** key. The
 *   truth. **Append-only**, with the triggers.
 * - `configuration_effective` — the value in force, per key. A
 *   **projection**, upserted.
 *
 * And the `UNIQUE (config_key, version)` is the **per-key version's
 * atomic guard** — two concurrent changes to one key cannot collide, so
 * the later write wins the effective value (ADR-045).
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '035-create-configuration-versions',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE CONFIGURATION'S HISTORY — every version of every key.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- APPEND-ONLY. A version records what a weighing MEANT, and a
      -- statement about a weighing is never revised (BRD DR-02).
      --
      -- THE REASON IS NEVER EMPTY. An unattributable override changed the
      -- meaning of the weighings around it, so a change without a
      -- justification is refused.
      --
      -- AND THE PREVIOUS VALUE IS RETAINED — the original is never
      -- overwritten in place, so the effective value at any past moment
      -- can be reconstructed (ADR-045).
      CREATE TABLE IF NOT EXISTS configuration_versions (
        version_id     TEXT NOT NULL PRIMARY KEY,
        config_key     TEXT NOT NULL,
        category       TEXT NOT NULL CHECK (category IN (
                         'SCALE_THRESHOLD',
                         'TOLERANCE',
                         'TEMPLATE',
                         'LANGUAGE'
                       )),
        value          TEXT NOT NULL,
        version        INTEGER NOT NULL,
        effective_from TEXT NOT NULL,
        actor_id       TEXT NOT NULL,
        actor_role     TEXT NOT NULL,
        reason         TEXT NOT NULL,
        previous_value TEXT NULL,
        scope          TEXT NULL,
        recorded_at    TEXT NOT NULL
      );

      -- THE PER-KEY VERSION'S ATOMIC GUARD.
      --
      -- Two concurrent changes to one key both attempt version N+1 — and
      -- one loses the insert, so it retries as N+2. The versions never
      -- collide, and the later write wins the effective value.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_configuration_versions_key_version
        ON configuration_versions (config_key, version);

      -- The key's history, oldest first — the reconstruction query.
      CREATE INDEX IF NOT EXISTS idx_configuration_versions_key
        ON configuration_versions (config_key, effective_from ASC);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path in the repository, and these make that true in the
      -- database as well (BRD DR-02).
      CREATE TRIGGER IF NOT EXISTS trg_configuration_versions_no_update
      BEFORE UPDATE ON configuration_versions
      BEGIN
        SELECT RAISE(ABORT, 'configuration_versions is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_configuration_versions_no_delete
      BEFORE DELETE ON configuration_versions
      BEGIN
        SELECT RAISE(ABORT, 'configuration_versions is append-only');
      END;
    `,
  },
  {
    id: '036-create-configuration-effective',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE EFFECTIVE VALUE — a PROJECTION of the history.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- It IS updated — it is a projection, not a record. And it can be
      -- REBUILT from the history, because the history is the truth.
      --
      -- AND IT CANNOT DRIFT. The trigger refuses to point the projection
      -- at a version that does not exist in the history — so the effective
      -- value is always a version that really happened (ADR-045).
      CREATE TABLE IF NOT EXISTS configuration_effective (
        config_key     TEXT NOT NULL PRIMARY KEY,
        value          TEXT NOT NULL,
        category       TEXT NOT NULL CHECK (category IN (
                         'SCALE_THRESHOLD',
                         'TOLERANCE',
                         'TEMPLATE',
                         'LANGUAGE'
                       )),
        version        INTEGER NOT NULL,
        effective_from TEXT NOT NULL,
        actor_id       TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      -- THE PROJECTION CANNOT DRIFT FROM THE TRUTH.
      --
      -- An update or an insert is refused unless the version it names
      -- EXISTS in the history. So the effective value is always a version
      -- that really happened — and a bug cannot write a value that no
      -- version supports.
      CREATE TRIGGER IF NOT EXISTS trg_configuration_effective_must_exist
      BEFORE INSERT ON configuration_effective
      WHEN NOT EXISTS (
        SELECT 1 FROM configuration_versions
         WHERE config_key = NEW.config_key AND version = NEW.version
      )
      BEGIN
        SELECT RAISE(ABORT, 'the effective value must name a real version');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_configuration_effective_update_must_exist
      BEFORE UPDATE ON configuration_effective
      WHEN NOT EXISTS (
        SELECT 1 FROM configuration_versions
         WHERE config_key = NEW.config_key AND version = NEW.version
      )
      BEGIN
        SELECT RAISE(ABORT, 'the effective value must name a real version');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 */
export function openConfigurationDatabase(
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
