/**
 * The container assignment's and the container master's SQLite tables.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO TABLES, TWO MUTABILITY RULES, TWO REASONS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * | Table | Mutable? | Why |
 * |---|---|---|
 * | `container_assignments` | **No** — append-only | It is the record of an **act**. BRD DR-02 forbids revising it. |
 * | `containers` | **Yes** | It is **reference data**. A container's known tare changes when it is re-weighed, and it goes out of service. That is a fact about the **container**, not about a weighing. |
 *
 * **The distinction is the one the whole product turns on: reference data
 * is maintained; the record of an act is not** (ADR-035).
 *
 * THE MASTER'S TARE IS NULLABLE, AND THE ASSIGNMENT'S IS NOT
 * -------------------------------------------------------
 * A container the master does not weigh has a **null** tare — and then the
 * empty container must be **weighed** instead. A tare of `0.0000` is not
 * null: it is a real known tare, and unit `004` already carries that rule
 * (S-12).
 *
 * The assignment's tare is **never null**, because by the time it is
 * recorded the tare has been *established* by one route or the other.
 *
 * THE TARE IS A DECIMAL STRING, NEVER A FLOAT
 * ------------------------------------------
 * BRD NFR-16 and C-11: the tare is a weight, at four decimal places, and
 * it is stored as TEXT. A column of REAL would round it.
 *
 * NO "CURRENT" COLUMN ON THE ASSIGNMENTS
 * --------------------------------------
 * The effective assignment is the **newest row** —
 * `ORDER BY assigned_at DESC, id DESC` — a total order. A column saying
 * which row is current would be a second source of truth, and mutating it
 * would rewrite history.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '024-create-containers',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE CONTAINER MASTER — WeighingMS's OWN reference data.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- BRD §9.3: "Container master | WeighingMS | Master". Unlike the
      -- recipe and the dyestuff master, this one is OURS — so it is a local
      -- table rather than a seam over the MES.
      --
      -- THIS TABLE IS UPDATABLE, and that is deliberate. A container's
      -- known tare changes when it is re-weighed, and the container goes
      -- out of service — and those are facts about the CONTAINER, not
      -- about a weighing. The assignment table beside it is append-only,
      -- because an assignment is a record of an ACT.
      --
      -- THE tare_qty IS NULLABLE, AND NULL IS NOT ZERO. A container the
      -- master does not weigh has no known tare, and then the empty
      -- container must be WEIGHED instead. A tare of 0 is a real known
      -- tare — "this container weighs nothing" — and unit 004 carries the
      -- same rule (S-12).
      --
      -- The tare is stored as TEXT, never REAL: BRD NFR-16 forbids a
      -- float for a quantity, and a REAL column would round it.
      CREATE TABLE IF NOT EXISTS containers (
        container_id  TEXT NOT NULL PRIMARY KEY,
        container_type TEXT NOT NULL CHECK (container_type IN ('DRUM','BUCKET','BAG')),
        tare_qty      TEXT NULL,
        tare_unit     TEXT NOT NULL,
        in_service    INTEGER NOT NULL CHECK (in_service IN (0,1))
      );
    `,
  },
  {
    id: '025-create-container-assignments',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE CONTAINER ASSIGNMENT, AS A RECORDED ACT.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per assignment. APPEND-ONLY: an assignment describes
      -- something that physically happened, and BRD DR-02 requires that
      -- such a record not be revised.
      --
      -- IT IS A RELATION, NOT A COLUMN. Q-10 asks whether one container
      -- holds one component or a whole recipe, and the two answers imply
      -- different data models — so the assignment is a table, and it holds
      -- under either answer (ADR-035). There is NO container_id column on
      -- the recipe component, because that would commit the model to an
      -- answer FCI has not given.
      --
      -- NO UNIQUE CONSTRAINT ON container_id. A container may legitimately
      -- serve several components — Q-10 is not decided here — and the
      -- story requires both assignments to be recorded.
      --
      -- THE TARE IS THE ASSIGNMENT'S OWN COPY. The device's tare is its
      -- CURRENT zero reference and is never persisted (ADR-015) — a stale
      -- one is a WRONG NUMBER. So the record carries the tare as it was
      -- at the moment of the assignment, rather than reading the live
      -- device — which, after the operator moves on, is the NEXT
      -- container's tare (ADR-035).
      --
      -- THE tare_unit IS CARRIED, NOT CONVERTED. A master tare in
      -- kilograms against a component in grams is recorded with its own
      -- unit, and no implicit conversion happens here.
      CREATE TABLE IF NOT EXISTS container_assignments (
        id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        component_id     TEXT NOT NULL,
        container_id     TEXT NOT NULL,
        container_type   TEXT NOT NULL CHECK (container_type IN ('DRUM','BUCKET','BAG')),
        tare_weight      TEXT NOT NULL,
        tare_unit        TEXT NOT NULL,
        tare_source      TEXT NOT NULL CHECK (tare_source IN ('CONTAINER_MASTER','WEIGHED_EMPTY_CONTAINER')),
        assignment_method TEXT NOT NULL CHECK (assignment_method IN ('SCAN','KEYED_IN')),
        operator_id      TEXT NOT NULL,
        assigned_at      TEXT NOT NULL,
        scale_id         TEXT NULL,
        recorded_at      TEXT NOT NULL
      );

      -- The effective assignment for a component. A TOTAL order —
      -- assigned_at alone is ambiguous when two rows land in the same
      -- millisecond, and "the latest" must have exactly one answer.
      CREATE INDEX IF NOT EXISTS idx_container_assignments_component
        ON container_assignments (component_id, assigned_at DESC, id DESC);

      -- The container's own history, across every component it served. This
      -- is the query a shade failure asks: which components used this
      -- container?
      CREATE INDEX IF NOT EXISTS idx_container_assignments_container
        ON container_assignments (container_id);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path, and these make that true in the database as well as
      -- in the repository.
      CREATE TRIGGER IF NOT EXISTS trg_container_assignments_no_update
      BEFORE UPDATE ON container_assignments
      BEGIN
        SELECT RAISE(ABORT, 'container_assignments is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_container_assignments_no_delete
      BEFORE DELETE ON container_assignments
      BEGIN
        SELECT RAISE(ABORT, 'container_assignments is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table the
 * other units use, so all the units can share one database file without any
 * of them re-applying the others' tables.
 */
export function openContainerDatabase(
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
