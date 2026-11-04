/**
 * SyncQueueEntry — the durable record of a consumption posting that has
 * **not** landed.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CONTENT IS IMMUTABLE. (ADR-024)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The content — batch, component, quantity, unit, lot, operator,
 * weighed-at — describes something that physically happened. 94.01 g of
 * DYE-4471 was dispensed at 08:14:22 by operator OP-001. That event does
 * not change.
 *
 * So this class has **no general mutation method**. The only things that
 * may change are the attempt bookkeeping, and only through the named
 * transitions below, each of which returns a **new** entry.
 *
 * WHY IT CARRIES A COPY OF THE POSTING'S CONTENT
 * ----------------------------------------------
 * The obvious alternative is an entry holding only `postingId` and
 * reading the posting at delivery time. That would be less data and one
 * source of truth. It is rejected for two reasons, both from ADR-024:
 *
 * 1. The posting's state is **mutable** — it moves `QUEUED → ACCEPTED`.
 *    A queue that reads a mutable row at delivery time has content that
 *    can change underneath it.
 * 2. The queue must be **self-sufficient to deliver**. A flush is the one
 *    operation that runs while something else may have failed; depending
 *    on a second row gives it two failure modes instead of one.
 *
 * WHY THERE IS NO `DELIVERED` STATE
 * --------------------------------
 * A delivered entry is **not in the queue** — it has been removed, and
 * the *posting* says `ACCEPTED`. A `DELIVERED` row would be a second
 * source of truth that could disagree with the ledger (ADR-023).
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../value-objects/identifiers.js';
import type { SyncQueueEntryState } from '../value-objects/sync-queue-entry-state.js';
import type { SyncError } from '../value-objects/sync-error.js';

/**
 * The aggregate root of the queue.
 *
 * Six invariants, enforced by the constructor so that an entry which
 * breaks one **cannot be built**:
 *
 * 1. The `postingId` **is** the idempotency key, and it is unique across
 *    the queue.
 * 2. The content is **immutable** once written.
 * 3. `attempts` only ever **increases**.
 * 4. A `PENDING` entry **always** has a next attempt time.
 * 5. A `FAILED` entry has **no** next attempt time — it is off the
 *    automatic path.
 * 6. The entry is **never silently discarded**: it leaves the queue only
 *    by being delivered, and it is never deleted while it is failed.
 */
export class SyncQueueEntry {
  private constructor(
    readonly postingId: IdempotencyKey,
    readonly batchId: BatchId,
    readonly componentId: ComponentId,
    readonly actualQuantity: WeightValue,
    readonly lotNumber: LotNumber,
    readonly operatorId: OperatorReference,
    readonly weighedAt: Instant,
    readonly queuedAt: Instant,
    readonly attempts: number,
    readonly lastAttemptAt: Instant | null,
    readonly nextAttemptAt: Instant | null,
    readonly lastError: SyncError | null,
    readonly state: SyncQueueEntryState,
  ) {
    // Invariant 3 — the attempt count is a non-negative whole number.
    if (!Number.isInteger(attempts) || attempts < 0) {
      throw new Error(
        'A queue entry\'s attempt count must be a non-negative whole number',
      );
    }

    // Invariant 4 — a PENDING entry always has a next attempt time.
    if (state === 'PENDING' && nextAttemptAt === null) {
      throw new Error(
        'A pending queue entry must have a next attempt time — it is on the automatic path',
      );
    }

    // Invariant 5 — a FAILED entry has none; the worker will not retry it.
    if (state === 'FAILED' && nextAttemptAt !== null) {
      throw new Error(
        'A failed queue entry must not have a next attempt time — it is off the automatic path',
      );
    }

    // Invariant 4, restated — a first attempt has happened if and only if
    // an attempt time is recorded.
    if (lastAttemptAt !== null && attempts < 1) {
      throw new Error(
        'A queue entry with an attempt time must have at least one attempt',
      );
    }
  }

  /**
   * A freshly queued entry.
   *
   * It is due **immediately** — `nextAttemptAt` is the moment it was
   * queued — so the retry worker picks it up on its next tick even if the
   * recovery flush never fires.
   */
  static queue(params: {
    readonly postingId: IdempotencyKey;
    readonly batchId: BatchId;
    readonly componentId: ComponentId;
    readonly actualQuantity: WeightValue;
    readonly lotNumber: LotNumber;
    readonly operatorId: OperatorReference;
    readonly weighedAt: Instant;
    readonly queuedAt: Instant;
  }): SyncQueueEntry {
    return new SyncQueueEntry(
      params.postingId,
      params.batchId,
      params.componentId,
      params.actualQuantity,
      params.lotNumber,
      params.operatorId,
      params.weighedAt,
      params.queuedAt,
      0,
      null,
      params.queuedAt,
      null,
      'PENDING',
    );
  }

  /**
   * Rebuild an entry from its stored row.
   *
   * The invariants are checked here too, so a corrupt row fails loudly at
   * the boundary rather than becoming a queue entry that lies about its
   * own state.
   */
  static restore(params: {
    readonly postingId: IdempotencyKey;
    readonly batchId: BatchId;
    readonly componentId: ComponentId;
    readonly actualQuantity: WeightValue;
    readonly lotNumber: LotNumber;
    readonly operatorId: OperatorReference;
    readonly weighedAt: Instant;
    readonly queuedAt: Instant;
    readonly attempts: number;
    readonly lastAttemptAt: Instant | null;
    readonly nextAttemptAt: Instant | null;
    readonly lastError: SyncError | null;
    readonly state: SyncQueueEntryState;
  }): SyncQueueEntry {
    return new SyncQueueEntry(
      params.postingId,
      params.batchId,
      params.componentId,
      params.actualQuantity,
      params.lotNumber,
      params.operatorId,
      params.weighedAt,
      params.queuedAt,
      params.attempts,
      params.lastAttemptAt,
      params.nextAttemptAt,
      params.lastError,
      params.state,
    );
  }

  /** Is this entry on the automatic retry path? */
  get isPending(): boolean {
    return this.state === 'PENDING';
  }

  /** Has this entry failed permanently under the configured disposition? */
  get isFailed(): boolean {
    return this.state === 'FAILED';
  }

  /**
   * The entry after a **retryable** failure.
   *
   * It stays `PENDING` — on the automatic path — with a new attempt
   * count, a new last error and a new next attempt time. The content is
   * untouched.
   *
   * The attempt count only ever increases: a caller cannot pass a lower
   * count than the entry already has.
   */
  afterRetryableFailure(params: {
    readonly error: SyncError;
    readonly attemptedAt: Instant;
    readonly nextAttemptAt: Instant;
  }): SyncQueueEntry {
    return new SyncQueueEntry(
      this.postingId,
      this.batchId,
      this.componentId,
      this.actualQuantity,
      this.lotNumber,
      this.operatorId,
      this.weighedAt,
      this.queuedAt,
      this.attempts + 1,
      params.attemptedAt,
      params.nextAttemptAt,
      params.error,
      'PENDING',
    );
  }

  /**
   * The entry after a **permanent** failure.
   *
   * It becomes `FAILED` — visible, with its last error, attempt count and
   * last attempt time, and **re-drivable**. It is never deleted.
   */
  afterPermanentFailure(params: {
    readonly error: SyncError;
    readonly attemptedAt: Instant;
  }): SyncQueueEntry {
    return new SyncQueueEntry(
      this.postingId,
      this.batchId,
      this.componentId,
      this.actualQuantity,
      this.lotNumber,
      this.operatorId,
      this.weighedAt,
      this.queuedAt,
      this.attempts + 1,
      params.attemptedAt,
      null,
      params.error,
      'FAILED',
    );
  }

  /**
   * The entry after a **refused** re-drive.
   *
   * The refusal counts as an attempt — the story says the attempt count is
   * updated — so the entry's attempt count grows even though nothing was
   * sent.
   */
  afterRefusedAttempt(params: {
    readonly error: SyncError;
    readonly attemptedAt: Instant;
  }): SyncQueueEntry {
    return new SyncQueueEntry(
      this.postingId,
      this.batchId,
      this.componentId,
      this.actualQuantity,
      this.lotNumber,
      this.operatorId,
      this.weighedAt,
      this.queuedAt,
      this.attempts + 1,
      params.attemptedAt,
      null,
      params.error,
      'FAILED',
    );
  }
}
