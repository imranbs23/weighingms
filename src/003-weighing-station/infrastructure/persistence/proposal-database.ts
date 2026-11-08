/**
 * The surplus proposal's SQLite table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TABLE. APPEND-ONLY. AND THE DECISION IS A NEW ROW.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story requires it: *"the proposal itself is persisted as one row per
 * over-dose"* — and the applied compensation is *"recorded with the
 * authorising user and the reason"* (BRD FR-24).
 *
 * **The `PROPOSED` row and the decision's row SHARE a `proposal_id`.** So
 * the history shows that the proposal was made **before** it was decided,
 * and the effective proposal is the newest row for that id.
 *
 * **AND THE FACTOR IS STORED**, because Q-06 is unanswered — so the stored
 * factor is the evidence of which rule produced the revision (ADR-038).
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
    id: '028-create-surplus-proposals',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE SURPLUS PROPOSAL — the recalculation, presented for acceptance.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per over-dose. APPEND-ONLY: the proposal and the decision
      -- are both records of what happened, and neither is revised.
      --
      -- THE PROPOSED ROW AND THE DECISION'S ROW SHARE A proposal_id. So
      -- the history shows that the proposal was made BEFORE it was decided
      -- and the effective proposal is the newest row for that id (ADR-029's
      -- shape applied to a decision).
      --
      -- THE FACTOR IS STORED because Q-06 is unanswered: it is the
      -- evidence of which rule produced the revision, and it cannot be
      -- recomputed once the rule changes (ADR-038).
      CREATE TABLE IF NOT EXISTS surplus_proposals (
        proposal_id        TEXT NOT NULL,
        component_id       TEXT NOT NULL,
        session_id         TEXT NOT NULL,
        surplus_amount     TEXT NOT NULL,
        overshoot          TEXT NOT NULL,
        surplus_percent    TEXT NULL,
        factor             TEXT NOT NULL,
        status             TEXT NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','DECLINED')),
        recalculated_json  TEXT NOT NULL,
        operator_id        TEXT NOT NULL,
        reason             TEXT NULL,
        created_at         TEXT NOT NULL,
        decided_at         TEXT NULL,
        recorded_at        TEXT NOT NULL,
        sequence           INTEGER NOT NULL,
        PRIMARY KEY (proposal_id, status)
      );

      -- The effective proposal for a component — the newest row.
      --
      -- The ordering is by the INSERTION SEQUENCE, and NOT by recorded_at.
      -- Two rows for one proposal land in the same millisecond, and a
      -- time-based ordering would make "which is the decision" arbitrary.
      -- The insertion sequence breaks the tie in the order the acts
      -- HAPPENED, which is ADR-029's rule applied to a decision.
      CREATE INDEX IF NOT EXISTS idx_surplus_proposals_component
        ON surplus_proposals (component_id, sequence DESC);

      -- THE TRIGGERS ARE THE ENFORCEMENT.
      CREATE TRIGGER IF NOT EXISTS trg_surplus_proposals_no_update
      BEFORE UPDATE ON surplus_proposals
      BEGIN
        SELECT RAISE(ABORT, 'surplus_proposals is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_surplus_proposals_no_delete
      BEFORE DELETE ON surplus_proposals
      BEGIN
        SELECT RAISE(ABORT, 'surplus_proposals is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 */
export function openProposalDatabase(
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
