/**
 * SqliteAuditEntryRepository — the trail.
 *
 * ══════════════════════════════════════════════════════════════════════
 * INSERT ONLY. NO UPDATE, NO DELETE. AND THE SEQUENCE IS ASSIGNED HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The row's `sequence` comes from the **database** — SQLite's
 * `AUTOINCREMENT` assigns it under the write lock — so the trail's order is
 * monotonic and **cannot tie** (ADR-043).
 *
 * And the entry's sequence is read back after the insert, so the caller
 * holds the same number the database assigned.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  AuditAction,
  AuditEntry,
  AuditSubject,
} from '../../domain/entities/audit-entry.js';
import type {
  AuditEntryRepository,
  AuditFilter,
  AuditStreamRepository,
} from '../../domain/ports/audit-entry-repository.js';
import type { SqliteDatabase } from './audit-database.js';

interface AuditRow {
  sequence: number;
  entry_id: string;
  action: string;
  actor_id: string;
  actor_role: string;
  subject: string;
  reason: string;
  occurred_at: string;
  recorded_at: string;
}

export class SqliteAuditEntryRepository
  implements AuditEntryRepository, AuditStreamRepository
{
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Record a privileged action.
   *
   * **INSERT ONLY** — and the database assigns the sequence.
   */
  async record(entry: AuditEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_entries
           (entry_id, action, actor_id, actor_role, subject, reason,
            occurred_at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.entryId,
        entry.action.value,
        entry.actorId,
        entry.actorRole,
        entry.subject.value,
        // The reason, VERBATIM. Never truncated.
        entry.reason,
        entry.occurredAt.toDate().toISOString(),
        this.clock().toISOString(),
      );

    // The sequence the DATABASE assigned — read back, so the caller holds
    // the same number the trail does.
    const row = this.db
      .prepare('SELECT sequence FROM audit_entries WHERE entry_id = ?')
      .get(entry.entryId) as unknown as { sequence: number } | undefined;

    if (row !== undefined) {
      entry.sequence = row.sequence;
    }
  }

  /**
   * Every entry, in **sequence order**.
   */
  async all(): Promise<readonly AuditEntry[]> {
    const rows = this.db
      .prepare('SELECT * FROM audit_entries ORDER BY sequence ASC')
      .all() as unknown as AuditRow[];

    return rows.map((row) => toEntry(row));
  }

  /**
   * The matching entries, in **sequence order**.
   *
   * An empty result is an empty array — never an error.
   */
  async filter(filter: AuditFilter): Promise<readonly AuditEntry[]> {
    const { sql, values } = buildFilter(filter);
    const rows = this.db
      .prepare(sql)
      .all(...values) as unknown as AuditRow[];

    return rows.map((row) => toEntry(row));
  }

  /**
   * The matching entries, **one at a time**.
   *
   * **A CURSOR, not an array** — so the export's peak memory is one
   * entry, whatever the range (ADR-044).
   *
   * And it applies **the same filter** as `filter` — one filter, one
   * implementation, so a query and an export of the same filter agree.
   */
  async *stream(filter: AuditFilter): AsyncIterable<AuditEntry> {
    const { sql, values } = buildFilter(filter);

    // The cursor is OPENED here and the rows are stepped one at a time —
    // `iterate()` does not collect them.
    const statement = this.db.prepare(sql);
    for (const row of statement.iterate(...values) as Iterable<AuditRow>) {
      yield toEntry(row);
    }
  }
}

/**
 * The filter's SQL and its values.
 *
 * **ONE implementation**, shared by `filter` and `stream` — so the query
 * and the export of the same filter cannot disagree (ADR-044).
 */
function buildFilter(filter: AuditFilter): {
  sql: string;
  values: string[];
} {
  const clauses: string[] = [];
  const values: string[] = [];

  if (filter.actorId !== undefined && filter.actorId !== null) {
    clauses.push('actor_id = ?');
    values.push(filter.actorId);
  }
  if (filter.action !== undefined && filter.action !== null) {
    clauses.push('action = ?');
    values.push(filter.action);
  }
  if (filter.from !== undefined && filter.from !== null) {
    clauses.push('occurred_at >= ?');
    values.push(filter.from.toISOString());
  }
  if (filter.to !== undefined && filter.to !== null) {
    clauses.push('occurred_at <= ?');
    values.push(filter.to.toISOString());
  }

  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  return {
    sql: `SELECT * FROM audit_entries ${where} ORDER BY sequence ASC`,
    values,
  };
}

/**
 * Rebuild an audit entry from its row.
 */
function toEntry(row: AuditRow): AuditEntry {
  const entry = new AuditEntry({
    entryId: row.entry_id,
    action: AuditAction.fromStored(row.action),
    actorId: row.actor_id,
    actorRole: row.actor_role,
    subject: AuditSubject.create(row.subject),
    reason: row.reason,
    occurredAt: Instant.of(new Date(row.occurred_at)),
  });

  entry.sequence = row.sequence;
  return entry;
}
