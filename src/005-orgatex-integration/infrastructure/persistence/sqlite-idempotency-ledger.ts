/**
 * SqliteIdempotencyLedger — the deduplication index.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PRIMARY KEY IS THE GUARANTEE. (ADR-023)
 * ══════════════════════════════════════════════════════════════════════
 *
 * `record` does **not** check first. It attempts the insert and lets the
 * database's UNIQUE constraint decide.
 *
 * That is deliberate. A check-then-insert has a race window between the
 * read and the write, and the story's edge case names exactly that
 * scenario: *"Two postings for the same component and batch are
 * submitted concurrently | The local guard admits exactly one."* Only the
 * constraint can admit exactly one.
 *
 * THERE IS NO DELETE
 * ------------------
 * Not "no delete for now" — the interface has no such method, so there
 * is nothing to call. A consumed key is consumed forever (BRD DR-01).
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type {
  IdempotencyLedger,
} from '../../domain/ports/posting-repositories.js';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.js';
import type { SqliteDatabase } from './orgatex-database.js';

export class SqliteIdempotencyLedger implements IdempotencyLedger {
  constructor(private readonly db: SqliteDatabase) {}

  async has(key: IdempotencyKey): Promise<boolean> {
    const row = this.db
      .prepare('SELECT idempotency_key FROM idempotency_ledger WHERE idempotency_key = ?')
      .get(key.value) as unknown as { idempotency_key: string } | undefined;
    return row !== undefined;
  }

  async find(key: IdempotencyKey): Promise<IdempotencyKey | null> {
    const row = this.db
      .prepare('SELECT posting_id FROM idempotency_ledger WHERE idempotency_key = ?')
      .get(key.value) as unknown as { posting_id: string } | undefined;
    return row === undefined ? null : IdempotencyKey.of(row.posting_id);
  }

  /**
   * Record that a key has been consumed.
   *
   * @throws when the key is already present — the duplicate refusal.
   */
  async record(
    key: IdempotencyKey,
    postingId: IdempotencyKey,
    at: Instant,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO idempotency_ledger (idempotency_key, posting_id, recorded_at)
         VALUES (?, ?, ?)`,
      )
      .run(key.value, postingId.value, at.toDate().toISOString());
  }
}
