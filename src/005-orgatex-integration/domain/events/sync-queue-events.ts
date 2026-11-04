/**
 * The sync queue's domain events.
 *
 * ══════════════════════════════════════════════════════════════════════
 * AN ATTEMPT EVENT AND AN OUTCOME EVENT ARE NOT REDUNDANT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The **attempt** event fires on every attempt, including the ones that
 * establish nothing. The **outcome** events fire only on a **definitive**
 * answer.
 *
 * So a caller that wants "what happened?" subscribes to the attempt; a
 * caller that wants "what is the state?" reads the entry. The same
 * separation bolt 006's posting events use, for the same reason.
 *
 * THERE IS NO "ENTRY CREATED" EVENT
 * ---------------------------------
 * A creation is not an interaction with the MES. The link-state machine
 * counts **contacts**, not intentions, and an event for every enqueue
 * would make the two indistinguishable.
 */
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { BatchId } from '../value-objects/identifiers.js';
import type { ComponentId } from '../value-objects/identifiers.js';
import type { SyncError } from '../value-objects/sync-error.js';

export interface SyncEntryQueued {
  readonly type: 'SYNC_ENTRY_QUEUED';
  readonly postingId: IdempotencyKey;
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly queuedAt: Date;
}

export interface SyncEntryAttempted {
  readonly type: 'SYNC_ENTRY_ATTEMPTED';
  readonly postingId: IdempotencyKey;
  readonly attemptedAt: Date;
  readonly outcome: 'DELIVERED' | 'RETRYABLE' | 'FAILED';
  readonly attempts: number;
  /** For the LOG, never for the client (BRD NFR-11). */
  readonly message: string;
}

export interface SyncEntryFailed {
  readonly type: 'SYNC_ENTRY_FAILED';
  readonly postingId: IdempotencyKey;
  readonly lastError: SyncError;
  readonly attempts: number;
  readonly lastAttemptAt: Date;
}

export interface SyncEntryDelivered {
  readonly type: 'SYNC_ENTRY_DELIVERED';
  readonly postingId: IdempotencyKey;
  readonly batchId: BatchId;
  readonly acceptedAt: Date;
}

export interface SyncQueueFlushed {
  readonly type: 'SYNC_QUEUE_FLUSHED';
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly remaining: number;
}

export type SyncQueueEvent =
  | SyncEntryQueued
  | SyncEntryAttempted
  | SyncEntryFailed
  | SyncEntryDelivered
  | SyncQueueFlushed;
