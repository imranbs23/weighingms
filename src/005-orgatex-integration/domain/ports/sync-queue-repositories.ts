/**
 * The sync queue's repository port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ABSENT METHODS ARE THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every rule about what may change is expressed by a method that does
 * **not** exist:
 *
 * | Absent | The rule it enforces |
 * |---|---|
 * | no `update` | The entry's content is immutable (ADR-024). Only the attempt bookkeeping may move, and only through the three named methods. |
 * | no `delete` | Nothing is discarded. `remove` exists for exactly one reason — the posting was **delivered** — and it is named for that, not `delete`. |
 *
 * A repository with no `update` cannot be used to mutate a record. That
 * is stronger than a convention, and it is stronger than a code review.
 *
 * THE ORDER IS A CONTRACT
 * -----------------------
 * `findDue` returns entries **in queue order** — `queued_at` ascending,
 * `posting_id` as the tie-breaker. The order is total and stable across
 * processes and across a restart, which is what makes the flush's
 * "delivered in the order they were queued" claim true (OQ-4).
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SyncQueueEntry } from '../entities/sync-queue-entry.js';
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { SyncError } from '../value-objects/sync-error.js';

export interface SyncQueueRepository {
  /**
   * Add an entry to the queue.
   *
   * @throws when the key is already queued — the PRIMARY KEY is the
   *         duplicate guard, exactly as the ledger's is (ADR-023).
   */
  enqueue(entry: SyncQueueEntry): Promise<void>;

  findByPostingId(
    postingId: IdempotencyKey,
  ): Promise<SyncQueueEntry | null>;

  /**
   * The entries that are due for an attempt, **in queue order**.
   *
   * Only `PENDING` entries are ever due. A `FAILED` entry is off the
   * automatic path.
   */
  findDue(now: Instant, limit: number): Promise<SyncQueueEntry[]>;

  /** Every entry, in queue order. */
  findAll(): Promise<SyncQueueEntry[]>;

  /** How many consumptions have not landed. */
  countUnlanded(): Promise<number>;

  /**
   * Record the outcome of an attempt.
   *
   * The attempt bookkeeping and the outcome are one write, so an attempt
   * that is not recorded is an attempt that will be repeated — which is
   * the safe direction.
   */
  recordAttempt(params: {
    readonly postingId: IdempotencyKey;
    readonly outcome: 'DELIVERED' | 'RETRYABLE' | 'FAILED';
    readonly error: SyncError | null;
    readonly attemptedAt: Instant;
    readonly nextAttemptAt: Instant | null;
    readonly attempts: number;
  }): Promise<void>;

  /** Mark an entry `FAILED` — visible and re-drivable, never deleted. */
  markFailed(params: {
    readonly postingId: IdempotencyKey;
    readonly error: SyncError;
    readonly attemptedAt: Instant;
    readonly attempts: number;
  }): Promise<void>;

  /**
   * Remove an entry — **only** because the posting was delivered.
   *
   * This is the only way out of the queue. A failed entry is never
   * removed.
   */
  remove(postingId: IdempotencyKey): Promise<void>;

  /** Move an entry's next attempt time. */
  reschedule(
    postingId: IdempotencyKey,
    nextAttemptAt: Instant,
  ): Promise<void>;
}
