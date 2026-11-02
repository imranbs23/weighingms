/**
 * The OrgaTEX write path's SQLite tables.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FOUR TABLES, AND EACH ONE ENFORCES A RULE.
 * ══════════════════════════════════════════════════════════════════════
 *
 *   consumption_postings  — the posting: content + state
 *   idempotency_ledger    — the dedup index: key → consumed
 *   posting_attempts      — append-only: one row per attempt
 *   batch_status_writes   — one row per status write
 *
 * And, as bolt 005 established, the tables that are **NOT** here:
 *
 *   NO batch table.    NO recipe table.    NO snapshot table.
 *
 * The MES owns the batch and the recipe; a snapshot of somebody else's
 * truth can always be re-fetched (ADR-021). The consumption posting is
 * different — it is a statement about what **we** did, and it cannot be
 * re-derived by asking the MES.
 *
 * THE LEDGER'S PRIMARY KEY IS THE GUARANTEE
 * ------------------------------------------
 * `idempotency_key TEXT PRIMARY KEY` is not a detail. It IS the
 * idempotency mechanism (ADR-023): the uniqueness constraint is
 * evaluated by the database at the moment of the write, so there is no
 * check-then-write window for a concurrent submission to slip through.
 *
 * QUANTITIES ARE TEXT
 * -------------------
 * `actual_quantity` is TEXT, not REAL. SQLite's REAL is an IEEE-754
 * double, which is exactly what BRD NFR-16 forbids for quantities.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '011-create-consumption-postings',
    sql: `
      -- One row per intended write of what was dispensed.
      --
      -- THE CONTENT IS IMMUTABLE (ADR-024). The columns from batch_id
      -- through created_at are written once and never changed — they
      -- describe something that physically happened, and if the quantity
      -- on this row disagrees with the weighing record it describes, one
      -- of the two is wrong and the weighing record is the source of
      -- truth.
      --
      -- ONLY state, rejection_code and rejection_detail may move, and
      -- only from 'QUEUED'. The repository enforces that with a guarded
      -- UPDATE, so a double-resolution affects zero rows and raises.
      CREATE TABLE IF NOT EXISTS consumption_postings (
        id               TEXT PRIMARY KEY,
        batch_id         TEXT NOT NULL,
        component_id     TEXT NOT NULL,
        actual_quantity  TEXT NOT NULL,
        unit             TEXT NOT NULL,
        lot_number       TEXT NOT NULL,
        operator_id      TEXT NOT NULL,
        weighed_at       TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        state            TEXT NOT NULL CHECK (state IN ('QUEUED','ACCEPTED','REJECTED')),
        rejection_code   TEXT,
        rejection_detail TEXT
      );
    `,
  },
  {
    id: '012-create-idempotency-ledger',
    sql: `
      -- THE DEDUPLICATION INDEX. The PRIMARY KEY on the key IS the
      -- idempotency guarantee (ADR-023).
      --
      -- It is separate from the postings because it answers a different
      -- question with a different lifetime: the ledger answers "has this
      -- key ever been consumed?", and the postings answer "what did we
      -- try to send?". Keeping them apart means the dedup decision never
      -- reads mutable state.
      --
      -- ONLY ACCEPTED POSTINGS ARE RECORDED HERE. A QUEUED posting's key
      -- is in the sync queue that bolt 007 owns.
      --
      -- THERE IS NO DELETE PATH. A consumed key is consumed forever
      -- (BRD DR-01, >= 5 years).
      CREATE TABLE IF NOT EXISTS idempotency_ledger (
        idempotency_key  TEXT PRIMARY KEY,
        posting_id       TEXT NOT NULL,
        recorded_at      TEXT NOT NULL,
        FOREIGN KEY (posting_id) REFERENCES consumption_postings(id)
      );
    `,
  },
  {
    id: '013-create-posting-attempts',
    sql: `
      -- APPEND-ONLY. One row per delivery attempt, including the ones
      -- that established nothing.
      --
      -- The attempt's outcome is WIDER than the posting's state: it may
      -- be 'UNKNOWN' or 'UNREACHABLE', which the posting's state may not
      -- be. The posting's state only advances on a DEFINITIVE answer.
      --
      -- The attempt records what happened AT that attempt; the posting
      -- records how it ended. A posting rejected on its third attempt
      -- has two REJECTED attempts and one final rejection — and that
      -- count is diagnostic information the story's edge case about a
      -- permanently failed posting needs.
      CREATE TABLE IF NOT EXISTS posting_attempts (
        id              TEXT PRIMARY KEY,
        posting_id      TEXT NOT NULL,
        attempted_at    TEXT NOT NULL,
        outcome         TEXT NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED','UNKNOWN','UNREACHABLE')),
        reason_code     TEXT,
        reason_detail   TEXT,
        FOREIGN KEY (posting_id) REFERENCES consumption_postings(id)
      );
    `,
  },
  {
    id: '014-create-batch-status-writes',
    sql: `
      -- One row per write attempt of the batch's weighing status.
      --
      -- THIS IS NOT A MIRROR OF THE MES'S BATCH. It holds what WE wrote.
      -- No OrgaTEX batch field other than the weighing status is ever
      -- altered (BRD IR-06, C-01), and the adapter's method takes a
      -- status rather than a batch so there is no parameter through
      -- which another field could be changed.
      CREATE TABLE IF NOT EXISTS batch_status_writes (
        id               TEXT PRIMARY KEY,
        batch_id         TEXT NOT NULL,
        status           TEXT NOT NULL,
        written_at       TEXT NOT NULL,
        state            TEXT NOT NULL CHECK (state IN ('QUEUED','ACCEPTED','REJECTED')),
        rejection_code   TEXT,
        rejection_detail TEXT
      );
    `,
  },
  {
    id: '015-index-postings-by-batch',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_consumption_postings_batch
        ON consumption_postings (batch_id, created_at);
    `,
  },
  {
    id: '016-index-attempts-by-posting',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_posting_attempts_posting
        ON posting_attempts (posting_id, attempted_at);
    `,
  },
  {
    id: '017-index-status-writes-by-batch',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_batch_status_writes_batch
        ON batch_status_writes (batch_id, written_at);
    `,
  },
];

/**
 * Open (or create) the database and apply the write path's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table
 * the identity and scale units use, so all three units can share one
 * database file without any of them re-applying the others' tables.
 */
export function openOrgatexDatabase(
  path: string,
  existing?: SqliteDatabase,
): SqliteDatabase {
  if (existing !== undefined) {
    // The foreign key pragma is PER-CONNECTION, and it is part of this
    // unit's enforcement — the ledger's row must reference a posting
    // that exists. So it is set on a shared handle too, not only on a
    // handle this unit opened.
    existing.exec('PRAGMA foreign_keys = ON');
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
