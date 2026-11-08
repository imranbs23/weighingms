/**
 * The material identity's and the lot capture's SQLite tables.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO TABLES. BOTH APPEND-ONLY. AND THE TRIGGERS ARE THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Bolt 010 refused to persist the **recipe** — it is a projection of
 * somebody else's truth, it can be re-fetched, and a persisted copy would
 * be a stale-looking-fresh risk (ADR-031).
 *
 * These two are the **opposite** case. A verification and a lot capture
 * describe something that **physically happened at this station**, and the
 * MES has **no idea** they happened — asking it again would not produce
 * the operator's attestation. So they cannot be re-derived, and they must
 * be durable (BRD DR-01: retained ≥ 5 years).
 *
 * **The distinction is the one the whole product turns on: the MES's truth
 * is not written down; the station's own acts are** (ADR-034).
 *
 * NO "CURRENT" COLUMN
 * ------------------
 * There is no `is_current`, no `superseded_at`, and no pointer table. The
 * effective record is **the newest row** — `ORDER BY verified_at DESC, id
 * DESC` and `ORDER BY captured_at DESC, id DESC`.
 *
 * Every one of those shapes would mutate a historical record, and each
 * would create a second source of truth that a partial failure could leave
 * inconsistent.
 *
 * THE TRIGGERS ARE NOT A REDUNDANCY
 * ---------------------------------
 * A repository with no update method is a **convention**. A trigger that
 * ABORTS is a **guarantee** — it holds against a migration script, a
 * repair script, and any future unit that decides to write here.
 *
 * THE CLOSED SETS ARE IN THE STORAGE LAYER
 * -----------------------------------------
 * `verified_by IN ('SCAN','ATTESTATION')` and `capture_method IN
 * ('SOURCE','SCAN','KEYED_IN')` are the traceability rules in the storage
 * layer: a third method cannot be written even by a path that bypasses
 * the domain.
 *
 * THE LOT IS NOT DE-DUPLICATED
 * ---------------------------
 * There is **no** unique constraint on the lot number. The story is
 * explicit: *"the same lot number is captured for two different components
 * → both captures are stored; a lot may legitimately serve several
 * components and is not de-duplicated."*
 *
 * A uniqueness constraint would also make the lot a **key** — a claim that
 * a lot identifies one component, which is false.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '022-create-material-identities',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE OPERATOR'S VERIFICATION, AS A RECORDED ACT.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per verification. APPEND-ONLY: a verification describes
      -- something that physically happened, and BRD DR-02 requires that
      -- such a record not be revised.
      --
      -- THERE IS NO "CURRENT" COLUMN. The effective identity is the newest
      -- row — ORDER BY verified_at DESC, id DESC (ADR-034). A column
      -- saying which row is current would be a second source of truth, and
      -- mutating it would rewrite history.
      --
      -- THE id IS THE INSERTION SEQUENCE, AND THAT IS WHAT IT IS FOR. It
      -- is the tie-breaker when two verifications land in the same
      -- millisecond, and it must break the tie in the order the acts
      -- HAPPENED — not at random (ADR-029's rule).
      --
      -- verified_at IS WHEN THE ACT HAPPENED. recorded_at IS WHEN THE ROW
      -- WAS WRITTEN. They are different moments, and a busy station must
      -- not have to lie about either.
      --
      -- THE barcode AND THE attested_claims ARE MUTUALLY EXCLUSIVE BY
      -- CONSTRUCTION: a SCAN carries the code it read, an ATTESTATION
      -- carries the claims the operator vouched for. A row carrying both
      -- would be claiming the machine read a label AND that the operator
      -- vouched for it — two different claims with different strength.
      CREATE TABLE IF NOT EXISTS material_identities (
        id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        component_id     TEXT NOT NULL,
        material_code    TEXT NOT NULL,
        verified_by      TEXT NOT NULL CHECK (verified_by IN ('SCAN','ATTESTATION')),
        operator_id      TEXT NOT NULL,
        verified_at      TEXT NOT NULL,
        barcode          TEXT NULL,
        attested_claims  TEXT NULL,
        recorded_at      TEXT NOT NULL,
        CHECK (
          (verified_by = 'SCAN' AND barcode IS NOT NULL AND attested_claims IS NULL)
          OR
          (verified_by = 'ATTESTATION' AND barcode IS NULL AND attested_claims IS NOT NULL)
        )
      );

      -- The effective identity for a component. A TOTAL order — verified_at
      -- alone is ambiguous when two records land in the same millisecond,
      -- and "the latest" must have exactly one answer.
      CREATE INDEX IF NOT EXISTS idx_material_identities_component
        ON material_identities (component_id, verified_at DESC, id DESC);

      -- THE TRIGGERS ARE THE ENFORCEMENT. There is no update path and no
      -- delete path, and these make that true in the database as well as
      -- in the repository.
      CREATE TRIGGER IF NOT EXISTS trg_material_identities_no_update
      BEFORE UPDATE ON material_identities
      BEGIN
        SELECT RAISE(ABORT, 'material_identities is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_material_identities_no_delete
      BEFORE DELETE ON material_identities
      BEGIN
        SELECT RAISE(ABORT, 'material_identities is append-only');
      END;
    `,
  },
  {
    id: '023-create-material-lot-captures',
    sql: `
      -- ═════════════════════════════════════════════════════════════════
      -- THE SUPPLIER LOT, AS A RECORDED ACT.
      -- ═════════════════════════════════════════════════════════════════
      --
      -- One row per capture. APPEND-ONLY, for the same reason as
      -- material_identities: a capture describes something that physically
      -- happened, and BRD DR-02 requires that it not be revised.
      --
      -- THERE IS NO "CURRENT" COLUMN AND NO "SUPERSEDED" COLUMN. The
      -- effective capture is the newest row — ORDER BY captured_at DESC, id
      -- DESC — and the story requires the superseded capture to be
      -- RETAINED rather than deleted.
      --
      -- NO UNIQUE CONSTRAINT ON lot_number. A lot may legitimately serve
      -- several components, and the story requires both captures to be
      -- stored. A uniqueness constraint would also make the lot a KEY — a
      -- claim that a lot identifies one component, which is false.
      --
      -- THE LOT IS AN IDENTIFIER, NEVER A QUANTITY. It is stored as TEXT
      -- with its source format preserved, and it is never converted to a
      -- number and never to a float (BRD NFR-16).
      CREATE TABLE IF NOT EXISTS material_lot_captures (
        id             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        component_id   TEXT NOT NULL,
        lot_number     TEXT NOT NULL,
        material_code  TEXT NOT NULL,
        capture_method TEXT NOT NULL CHECK (capture_method IN ('SOURCE','SCAN','KEYED_IN')),
        captured_by    TEXT NOT NULL,
        captured_at    TEXT NOT NULL,
        recorded_at    TEXT NOT NULL
      );

      -- The effective capture for a component. A TOTAL order, for the same
      -- reason as every other "the latest" lookup in this product.
      CREATE INDEX IF NOT EXISTS idx_material_lot_captures_component
        ON material_lot_captures (component_id, captured_at DESC, id DESC);

      -- The lot's own history, across every component it served. This is
      -- the query a shade failure asks: which components used this lot?
      CREATE INDEX IF NOT EXISTS idx_material_lot_captures_lot
        ON material_lot_captures (lot_number);

      -- THE TRIGGERS ARE THE ENFORCEMENT.
      CREATE TRIGGER IF NOT EXISTS trg_material_lot_captures_no_update
      BEFORE UPDATE ON material_lot_captures
      BEGIN
        SELECT RAISE(ABORT, 'material_lot_captures is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_material_lot_captures_no_delete
      BEFORE DELETE ON material_lot_captures
      BEGIN
        SELECT RAISE(ABORT, 'material_lot_captures is append-only');
      END;
    `,
  },
];

/**
 * Open (or create) the database and apply this unit's migrations.
 *
 * The migrations are applied through the SAME `schema_migrations` table the
 * identity, scale, OrgaTEX and batch-management units use, so all the units
 * can share one database file without any of them re-applying the others'
 * tables.
 */
export function openMaterialDatabase(
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
