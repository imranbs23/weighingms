/**
 * SqliteSyncQueueRepository — the durable sync queue.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NO GENERAL UPDATE. THE ABSENT METHOD IS THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no `update` method. The entry's content is immutable
 * (ADR-024), and only the attempt bookkeeping may move — and only
 * through the three named methods below.
 *
 * THE ORDER IS A CONTRACT
 * -----------------------
 * `findDue` orders by `queued_at ASC, posting_id ASC`. The tie-breaker
 * makes the order **total**: two entries queued in the same millisecond
 * still have a defined order, and that order is the same after a
 * restart. Without it, "delivered in the order they were queued" would
 * be a claim the database could not keep.
 *
 * `remove` is the ONLY way out of the queue, and it exists for exactly
 * one reason: the posting was **delivered**. A failed entry is never
 * removed — the story's "never silently discarded" (BRD FR-20, FR-33).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { SyncQueueEntry } from '../../domain/entities/sync-queue-entry.js';
import type { SyncQueueRepository } from '../../domain/ports/sync-queue-repositories.js';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../domain/value-objects/identifiers.js';
import {
  SyncError,
  type SyncErrorCode,
} from '../../domain/value-objects/sync-error.js';
import type { SyncQueueEntryState } from '../../domain/value-objects/sync-queue-entry-state.js';
import type { SqliteDatabase } from './orgatex-database.js';

interface QueueRow {
  posting_id: string;
  batch_id: string;
  component_id: string;
  actual_quantity: string;
  unit: string;
  lot_number: string;
  operator_id: string;
  weighed_at: string;
  queued_at: string;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  last_error_detail: string | null;
  state: SyncQueueEntryState;
}

export class SqliteSyncQueueRepository implements SyncQueueRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async enqueue(entry: SyncQueueEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sync_queue_entries (
           posting_id, batch_id, component_id, actual_quantity, unit,
           lot_number, operator_id, weighed_at, queued_at, attempts,
           last_attempt_at, next_attempt_at, last_error_code,
           last_error_summary, last_error_detail, state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.postingId.value,
        entry.batchId.value,
        entry.componentId.value,
        entry.actualQuantity.toJSON(),
        entry.actualQuantity.unit,
        entry.lotNumber.value,
        entry.operatorId.value,
        entry.weighedAt.toDate().toISOString(),
        entry.queuedAt.toDate().toISOString(),
        entry.attempts,
        entry.lastAttemptAt?.toDate().toISOString() ?? null,
        entry.nextAttemptAt?.toDate().toISOString() ?? null,
        entry.lastError?.code ?? null,
        entry.lastError?.summary ?? null,
        entry.lastError?.detail ?? null,
        entry.state,
      );
  }

  async findByPostingId(
    postingId: IdempotencyKey,
  ): Promise<SyncQueueEntry | null> {
    const row = this.db
      .prepare('SELECT * FROM sync_queue_entries WHERE posting_id = ?')
      .get(postingId.value) as unknown as QueueRow | undefined;
    return row === undefined ? null : toEntry(row);
  }

  async findDue(now: Instant, limit: number): Promise<SyncQueueEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_queue_entries
          WHERE state = 'PENDING' AND next_attempt_at <= ?
          ORDER BY queued_at ASC, posting_id ASC
          LIMIT ?`,
      )
      .all(now.toDate().toISOString(), limit) as unknown as QueueRow[];
    return rows.map(toEntry);
  }

  async findAll(): Promise<SyncQueueEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_queue_entries
          ORDER BY queued_at ASC, posting_id ASC`,
      )
      .all() as unknown as QueueRow[];
    return rows.map(toEntry);
  }

  async countUnlanded(): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM sync_queue_entries')
      .get() as unknown as { c: number };
    return row.c;
  }

  async recordAttempt(params: {
    readonly postingId: IdempotencyKey;
    readonly outcome: 'DELIVERED' | 'RETRYABLE' | 'FAILED';
    readonly error: SyncError | null;
    readonly attemptedAt: Instant;
    readonly nextAttemptAt: Instant | null;
    readonly attempts: number;
  }): Promise<void> {
    // A `FAILED` outcome takes the entry OFF the automatic path, so its
    // state must change with it. Leaving `state = 'PENDING'` while
    // clearing `next_attempt_at` would break the table's own CHECK
    // constraint — and a constraint violation is a loud failure, which is
    // better than a row that lies about its state.
    const state = params.outcome === 'FAILED' ? 'FAILED' : 'PENDING';

    const result = this.db
      .prepare(
        `UPDATE sync_queue_entries
            SET attempts = ?,
                last_attempt_at = ?,
                next_attempt_at = ?,
                last_error_code = ?,
                last_error_summary = ?,
                last_error_detail = ?,
                state = ?
          WHERE posting_id = ?`,
      )
      .run(
        params.attempts,
        params.attemptedAt.toDate().toISOString(),
        params.nextAttemptAt?.toDate().toISOString() ?? null,
        params.error?.code ?? null,
        params.error?.summary ?? null,
        params.error?.detail ?? null,
        state,
        params.postingId.value,
      );

    if (result.changes === 0) {
      throw new Error(
        `No queue entry for ${params.postingId.value} — an attempt cannot be recorded against nothing`,
      );
    }
  }

  async markFailed(params: {
    readonly postingId: IdempotencyKey;
    readonly error: SyncError;
    readonly attemptedAt: Instant;
    readonly attempts: number;
  }): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE sync_queue_entries
            SET state = 'FAILED',
                attempts = ?,
                last_attempt_at = ?,
                next_attempt_at = NULL,
                last_error_code = ?,
                last_error_summary = ?,
                last_error_detail = ?
          WHERE posting_id = ?`,
      )
      .run(
        params.attempts,
        params.attemptedAt.toDate().toISOString(),
        params.error.code,
        params.error.summary,
        params.error.detail,
        params.postingId.value,
      );

    if (result.changes === 0) {
      throw new Error(
        `No queue entry for ${params.postingId.value} — it cannot be marked failed`,
      );
    }
  }

  async remove(postingId: IdempotencyKey): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM sync_queue_entries WHERE posting_id = ?')
      .run(postingId.value);

    if (result.changes === 0) {
      throw new Error(
        `No queue entry for ${postingId.value} — only a delivered entry may be removed`,
      );
    }
  }

  async reschedule(
    postingId: IdempotencyKey,
    nextAttemptAt: Instant,
  ): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE sync_queue_entries
            SET next_attempt_at = ?
          WHERE posting_id = ? AND state = 'PENDING'`,
      )
      .run(nextAttemptAt.toDate().toISOString(), postingId.value);

    if (result.changes === 0) {
      throw new Error(
        `No pending queue entry for ${postingId.value} — a failed entry is off the automatic path`,
      );
    }
  }
}

/**
 * Rebuild an entry from its row.
 *
 * The quantity is read back as a **string** — it was stored as one, so
 * nothing is lost to a float on the way back in.
 */
function toEntry(row: QueueRow): SyncQueueEntry {
  return SyncQueueEntry.restore({
    postingId: IdempotencyKey.of(row.posting_id),
    batchId: BatchId.create(row.batch_id),
    componentId: ComponentId.create(row.component_id),
    actualQuantity: WeightValue.of(row.actual_quantity, row.unit),
    lotNumber: LotNumber.create(row.lot_number),
    operatorId: OperatorReference.create(row.operator_id),
    weighedAt: Instant.of(new Date(row.weighed_at)),
    queuedAt: Instant.of(new Date(row.queued_at)),
    attempts: row.attempts,
    lastAttemptAt:
      row.last_attempt_at === null
        ? null
        : Instant.of(new Date(row.last_attempt_at)),
    nextAttemptAt:
      row.next_attempt_at === null
        ? null
        : Instant.of(new Date(row.next_attempt_at)),
    lastError:
      row.last_error_code === null
        ? null
        : SyncError.of(
            row.last_error_code as SyncErrorCode,
            row.last_error_summary ?? '',
            row.last_error_detail ?? '',
          ),
    state: row.state,
  });
}
