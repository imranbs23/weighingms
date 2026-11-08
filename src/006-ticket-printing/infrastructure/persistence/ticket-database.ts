/**
 * The ticket unit's database.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO TABLES. BOTH APPEND-ONLY. AND ONE `UNIQUE` THAT MATTERS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `tickets` — one row per session, with the `UNIQUE` on `session_id`
 *   that makes "exactly one ticket per session" **atomic** rather than a
 *   racy check (ADR-042).
 * - `ticket_lines` — one row per confirmed component.
 * - `print_jobs` — one row per print attempt.
 *
 * **AND EVERY QUANTITY IS TEXT** — BRD NFR-16, and the values are the
 * records' **own** strings, so the ticket's quantities are identical to
 * the recorded weighings (NFR-2).
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '031-create-tickets',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE TICKET — a read model over the immutable weighing records.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- The batch's identity is CARRIED, not computed — the order
      -- reference, the machine reference and the shade are the MES's.
      --
      -- THE TEMPLATE, THE LANGUAGE AND THE GENERATION MOMENT ARE CAPTURED.
      -- A later template or locale change must not alter an existing
      -- ticket — so the template id is RECORDED here, and the template's
      -- CONTENT is configuration's (BRD IR-16, Q-11, Q-12).
      --
      -- AND THE ONE-TICKET-PER-SESSION RULE IS A CONSTRAINT, not a check.
      -- A check-then-write is racy, and the race admits two tickets for
      -- one batch — and then the operator does not know which to print
      -- (ADR-042).
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id         TEXT NOT NULL PRIMARY KEY,
        session_id        TEXT NOT NULL,
        batch_id          TEXT NOT NULL,
        order_ref         TEXT NOT NULL,
        machine_ref       TEXT NOT NULL,
        shade_code        TEXT NOT NULL,
        operator_id       TEXT NOT NULL,
        generated_at      TEXT NOT NULL,
        language          TEXT NOT NULL,
        template_id       TEXT NOT NULL,
        tolerance_outcome TEXT NOT NULL
          CHECK (tolerance_outcome IN ('WITHIN_TOLERANCE','OUT_OF_TOLERANCE')),
        line_count        INTEGER NOT NULL,
        recorded_at       TEXT NOT NULL
      );

      -- THE IDEMPOTENCY GUARD. One ticket per session, atomically.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_session
        ON tickets (session_id);

      -- The batch's own tickets, across every session.
      CREATE INDEX IF NOT EXISTS idx_tickets_batch
        ON tickets (batch_id, generated_at DESC);

      -- A ticket is a record of its own act, and it is never revised
      -- (BRD DR-02).
      CREATE TRIGGER IF NOT EXISTS trg_tickets_no_update
      BEFORE UPDATE ON tickets
      BEGIN
        SELECT RAISE(ABORT, 'tickets is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_tickets_no_delete
      BEFORE DELETE ON tickets
      BEGIN
        SELECT RAISE(ABORT, 'tickets is append-only');
      END;
    `,
  },
  {
    id: '032-create-ticket-lines',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE TICKET'S LINES — one per CONFIRMED component.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- EVERY QUANTITY IS TEXT, and it is the RECORD'S OWN STRING. The
      -- acceptance criterion is that the ticket's quantities are IDENTICAL
      -- to the recorded weighings — so they are not re-derived, not
      -- re-formatted, and NOT CONVERTED (NFR-2, BRD NFR-16, ADR-042).
      --
      -- AND EACH LINE KEEPS ITS OWN UNIT. A line is a reproduction of one
      -- weighing; a TOTAL is a derived fact and gets a unit of its own
      -- (bolt 018's summary). Converting a line's unit would make the
      -- ticket disagree with the record.
      --
      -- THE ZONE IS CARRIED, so a line confirmed under a supervisor
      -- override carries OVER — and the ticket's overall outcome is
      -- computed from these.
      CREATE TABLE IF NOT EXISTS ticket_lines (
        line_id          TEXT NOT NULL PRIMARY KEY,
        ticket_id        TEXT NOT NULL,
        sequence         INTEGER NOT NULL,
        component_id     TEXT NOT NULL,
        material_code    TEXT NOT NULL,
        target_quantity  TEXT NOT NULL,
        target_unit      TEXT NOT NULL,
        actual_quantity  TEXT NOT NULL,
        actual_unit      TEXT NOT NULL,
        lot_number       TEXT NULL,
        container_id     TEXT NULL,
        scale_id         TEXT NOT NULL,
        zone_at_confirm  TEXT NOT NULL
          CHECK (zone_at_confirm IN ('OVER','OK','NEAR','UNDER')),
        operator_id      TEXT NOT NULL,
        weighed_at       TEXT NOT NULL
      );

      -- The ticket's lines, in recipe order.
      CREATE INDEX IF NOT EXISTS idx_ticket_lines_ticket
        ON ticket_lines (ticket_id, sequence);

      -- A line is a record of a weighing, and it is never revised
      -- (BRD DR-02).
      CREATE TRIGGER IF NOT EXISTS trg_ticket_lines_no_update
      BEFORE UPDATE ON ticket_lines
      BEGIN
        SELECT RAISE(ABORT, 'ticket_lines is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_ticket_lines_no_delete
      BEFORE DELETE ON ticket_lines
      BEGIN
        SELECT RAISE(ABORT, 'ticket_lines is append-only');
      END;
    `,
  },
  {
    id: '033-create-print-jobs',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE PRINT JOBS — one row per ATTEMPT.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- Each attempt is its OWN row: the story says "each attempt is a new
      -- row in the QUEUED → PRINTING → DONE|FAILED lifecycle".
      --
      -- AND is_reprint COMES FROM THE REQUEST'S REASON — never from the
      -- count of prior jobs. A double-tap produces two jobs, and the
      -- second is still a FIRST PRINT unless a reason was supplied
      -- (BRD FR-28).
      --
      -- THE ERROR IS STORED AND IS VISIBLE. The operator needs to know WHY
      -- the paper did not come out, and they need the job to reprint
      -- (BRD FR-19, B-7).
      CREATE TABLE IF NOT EXISTS print_jobs (
        job_id        TEXT NOT NULL PRIMARY KEY,
        ticket_id     TEXT NOT NULL,
        state         TEXT NOT NULL
          CHECK (state IN ('QUEUED','PRINTING','DONE','FAILED')),
        is_reprint    INTEGER NOT NULL DEFAULT 0,
        reprint_of    TEXT NULL,
        -- THE REPRINT'S REASON, ITS ACTOR AND THE ACTOR'S ROLE.
        --
        -- The reason is stored VERBATIM — the bound is validated at the
        -- request boundary, and never enforced by TRUNCATING the stored
        -- value. And it is in CLEAR TEXT: it is a record, not a credential
        -- (ADR-005).
        --
        -- And the actor's role records WHOEVER pressed reprint, which may
        -- be the operator — a reprint is privileged but does not require
        -- supervisor authentication in this build (BRD FR-35).
        reason        TEXT NULL,
        actor_id      TEXT NULL,
        actor_role    TEXT NULL,
        attempted_at  TEXT NOT NULL,
        completed_at  TEXT NULL,
        error         TEXT NULL,
        recorded_at   TEXT NOT NULL
      );

      -- The ticket's own jobs, newest first.
      CREATE INDEX IF NOT EXISTS idx_print_jobs_ticket
        ON print_jobs (ticket_id, attempted_at DESC);

      -- A SETTLED JOB MAY NOT BE EDITED. The story says "no attempt is
      -- edited after it settles" — so the trigger fires on the settled
      -- states only, and a job in QUEUED or PRINTING CAN be updated,
      -- because that is how it moves.
      CREATE TRIGGER IF NOT EXISTS trg_print_jobs_settled_no_update
      BEFORE UPDATE ON print_jobs
      WHEN OLD.state IN ('DONE','FAILED')
      BEGIN
        SELECT RAISE(ABORT, 'a settled print job may not be edited');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_print_jobs_no_delete
      BEFORE DELETE ON print_jobs
      BEGIN
        SELECT RAISE(ABORT, 'print_jobs is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 */
export function openTicketDatabase(
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
  db.exec('synchronous = FULL');
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
