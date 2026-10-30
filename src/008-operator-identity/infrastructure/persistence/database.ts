/**
 * The SQLite database and its migrations.
 *
 * WHY `node:sqlite` AND NOT `better-sqlite3`
 * ------------------------------------------
 * The tech stack originally named `better-sqlite3`. It cannot be installed
 * in this environment: it requires node-gyp and a Visual Studio C++ build
 * toolchain, which is not present. The tech stack's promise that the
 * product is "self-contained and demonstrable offline" and runs on
 * "Windows/Linux/macOS" does not survive a dependency that needs a compiler
 * the user must install first.
 *
 * Node 22+ ships `node:sqlite` as a built-in. It needs no build step, and
 * it is the same argument that was made for using Node's built-in Argon2id
 * instead of the `argon2` npm package (ADR-001).
 *
 * The behavioural differences that matter to the repositories are documented
 * on each adapter, and were established by probing the driver rather than
 * by reading better-sqlite3's documentation:
 *
 *   - booleans CANNOT be bound (better-sqlite3 also rejects them) — the
 *     adapters convert to 0/1 integers explicitly;
 *   - `undefined` CANNOT be bound — the adapters use NULL explicitly;
 *   - rows are returned as null-prototype objects.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

/**
 * Migrations, applied in order at startup.
 *
 * Each migration runs exactly once. The applied set is recorded in
 * `schema_migrations` so a restart does not re-apply them.
 */
const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '001-create-operators',
    sql: `
      CREATE TABLE IF NOT EXISTS operators (
        id            TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')),
        active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: '002-create-credentials',
    sql: `
      CREATE TABLE IF NOT EXISTS credentials (
        operator_id  TEXT NOT NULL,
        role         TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')),
        secret_hash  TEXT NOT NULL,
        rotated_at   TEXT NOT NULL,
        PRIMARY KEY (operator_id, role),
        FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: '003-create-identity-sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS identity_sessions (
        id               TEXT PRIMARY KEY,
        operator_id      TEXT NOT NULL,
        role             TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')),
        method           TEXT NOT NULL CHECK (method IN ('LOCAL','DIRECTORY')),
        token_hash       TEXT NOT NULL UNIQUE,
        authenticated_at TEXT NOT NULL,
        expires_at       TEXT NOT NULL,
        ended_at         TEXT,
        ended_cause      TEXT,
        FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: '004-index-identity-sessions',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_identity_sessions_operator
        ON identity_sessions (operator_id);
      CREATE INDEX IF NOT EXISTS idx_identity_sessions_expires
        ON identity_sessions (expires_at);
    `,
  },
  {
    id: '005-create-supervisor-authorisations',
    sql: `
      CREATE TABLE IF NOT EXISTS supervisor_authorisations (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL,
        supervisor_id  TEXT NOT NULL,
        -- The operator the exception was raised FOR. NULL when the
        -- privileged action was attempted with no signed-in operator: the
        -- attempt is still audited, but such an authorisation can never be
        -- applied. ADR-003 requires the consuming session to belong to
        -- THIS operator, so the field must be stored.
        requested_operator_id TEXT,
        action         TEXT NOT NULL CHECK (action IN (
                         'CONFIRM_COMPONENT',
                         'TOLERANCE_OVERRIDE',
                         'MANUAL_SCALE_RESELECTION',
                         'CALIBRATION_BYPASS'
                       )),
        subject        TEXT NOT NULL,
        -- The reason is stored in CLEAR TEXT by decision (ADR-005). It is a
        -- record, not a credential: it authorises nothing, and it must be
        -- readable by an auditor years later. Do NOT hash this column.
        reason         TEXT NOT NULL,
        authorised_at  TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        FOREIGN KEY (supervisor_id) REFERENCES operators(id),
        FOREIGN KEY (requested_operator_id) REFERENCES operators(id)
      );
    `,
  },
  {
    id: '006-create-authorisation-consumptions',
    sql: `
      -- Consumption is a SEPARATE append-only record, not a flag on the
      -- authorisation (ADR-006). The authorisation is never updated.
      --
      -- The UNIQUE constraint on authorisation_id IS the single-use rule:
      -- it makes a double-spend impossible even under concurrency, where
      -- the service's existence check is racy.
      CREATE TABLE IF NOT EXISTS authorisation_consumptions (
        id               TEXT PRIMARY KEY,
        authorisation_id TEXT NOT NULL UNIQUE,
        action           TEXT NOT NULL,
        subject          TEXT NOT NULL,
        consumed_at      TEXT NOT NULL,
        operator_id      TEXT NOT NULL,
        FOREIGN KEY (authorisation_id) REFERENCES supervisor_authorisations(id)
      );
    `,
  },
  {
    id: '007-index-authorisations',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_supervisor_authorisations_subject
        ON supervisor_authorisations (subject);
      CREATE INDEX IF NOT EXISTS idx_supervisor_authorisations_expires
        ON supervisor_authorisations (expires_at);
      -- No index on authorisation_consumptions.authorisation_id: the UNIQUE
      -- constraint already creates one. A second would be a duplicate.
    `,
  },
];

/**
 * Open (or create) the database and apply migrations.
 *
 * `synchronous = FULL` and WAL are set for the credential path: a power
 * loss must not lose a credential row, because losing one locks an
 * operator out permanently (NFR-05).
 */
export function openDatabase(path: string): SqliteDatabase {
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
      throw new Error(`Migration ${migration.id} failed: ${(e as Error).message}`);
    }
  }

  return db;
}
