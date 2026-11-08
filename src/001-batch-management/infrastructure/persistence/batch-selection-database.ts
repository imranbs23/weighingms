/**
 * The batch selection's SQLite table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TABLE. APPEND-ONLY. AND THE TRIGGERS ARE THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is unit 001's **first durable artefact**. Bolt 008 refused to
 * persist the queue, and that refusal stands — the queue is re-fetchable,
 * and a second durable copy would be a second source of truth.
 *
 * A selection is the **opposite** case. It cannot be re-derived: the MES
 * has no idea the operator chose a batch, and asking it again would not
 * produce the choice. So it is durable.
 *
 * NO "ACTIVE" COLUMN
 * ------------------
 * There is no `superseded_at`, no `is_active`, and no pointer table. The
 * active selection is **the newest row** (ADR-029).
 *
 * Every one of those shapes would mutate a historical record — the same
 * rejection ADR-006 applied to the identity unit's `consumed_at` — and
 * each would create a second source of truth that a partial failure could
 * leave inconsistent.
 *
 * THE TRIGGERS ARE NOT A REDUNDANCY
 * ---------------------------------
 * A repository with no update method is a **convention**. A trigger that
 * ABORTS is a **guarantee** — it holds against a migration script, a
 * repair script, and any future unit that decides to write here.
 *
 * THE METHOD'S CHECK IS THE CLOSED SET
 * ------------------------------------
 * `selection_method IN ('SCAN','TOUCH')` is the traceability rule in the
 * storage layer: a third method cannot be written even by a path that
 * bypasses the domain.
 *
 * TIMESTAMPS ARE ISO-8601 TEXT
 * ----------------------------
 * Matching every other table in this product.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '021-create-batch-selections',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE OPERATOR'S CHOICE, AS A RECORDED ACT.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per act of choosing. APPEND-ONLY: a selection describes
      -- something that physically happened, and BRD DR-02 requires that
      -- such a record not be revised.
      --
      -- THERE IS NO "CURRENT" COLUMN. The active selection is the newest
      -- row — ORDER BY selected_at DESC, id DESC (ADR-029). A column
      -- saying which row is active would be a second source of truth, and
      -- mutating it would rewrite history.
      --
      -- THE ORDER AND THE MACHINE ARE COPIED. The crumb shows batch,
      -- order and machine (BRD FR-34), and if the selection carried only
      -- the batch id the crumb would have to be re-derived from a queue
      -- read at render time — which might have changed, been filtered
      -- away, or be unreachable. The operator would then see a crumb that
      -- disagrees with the selection they made.
      --
      -- selected_at IS WHEN THE ACT HAPPENED. recorded_at IS WHEN THE ROW
      -- WAS WRITTEN. They are different moments, and a station that was
      -- busy for a minute must not have to lie about either.
      --
      -- NO QUANTITIES APPEAR HERE. A selection carries no target, no
      -- tolerance and no weight — those belong to units 002 and 003.
      -- THE id IS THE INSERTION SEQUENCE, AND THAT IS WHAT IT IS FOR.
      -- It is the tie-breaker when two selections land in the same
      -- millisecond, and it must break the tie in the order the acts
      -- HAPPENED — not at random. A random identifier would make "the
      -- active selection" arbitrary in exactly the case where two acts
      -- coincide, which is the case the tie-breaker exists for
      -- (ADR-029). The same mechanism unit 005's link_transitions uses.
      CREATE TABLE IF NOT EXISTS batch_selections (
        id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        batch_id         TEXT NOT NULL,
        order_ref        TEXT NOT NULL,
        machine_ref      TEXT NOT NULL,
        operator_id      TEXT NOT NULL,
        selected_at      TEXT NOT NULL,
        selection_method TEXT NOT NULL CHECK (selection_method IN ('SCAN','TOUCH')),
        recorded_at      TEXT NOT NULL
      );

      -- The read of the active selection. A TOTAL order — selected_at
      -- alone is ambiguous when two selections land in the same
      -- millisecond, and "the latest" must have exactly one answer. The
      -- id is the insertion sequence, so the tie is broken in the order
      -- the acts happened.
      CREATE INDEX IF NOT EXISTS idx_batch_selections_latest
        ON batch_selections (selected_at DESC, id DESC);

      -- The history, for a batch. The operator's own past choices, in
      -- order.
      CREATE INDEX IF NOT EXISTS idx_batch_selections_batch
        ON batch_selections (batch_id, selected_at DESC, id DESC);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path, and these make that true in the database as well as
      -- in the repository.
      CREATE TRIGGER IF NOT EXISTS trg_batch_selections_no_update
      BEFORE UPDATE ON batch_selections
      BEGIN
        SELECT RAISE(ABORT, 'batch_selections is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_batch_selections_no_delete
      BEFORE DELETE ON batch_selections
      BEGIN
        SELECT RAISE(ABORT, 'batch_selections is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table the
 * identity, scale and OrgaTEX units use, so all four units can share one
 * database file without any of them re-applying the others' tables.
 */
export function openBatchManagementDatabase(
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
