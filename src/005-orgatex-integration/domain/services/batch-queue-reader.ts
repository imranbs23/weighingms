/**
 * BatchQueueReader — the read half of the queue seam.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONE PLACE THE "SERVE THE LAST KNOWN-GOOD" RULE LIVES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Everything else in this unit is a projection or a rule. This is the
 * orchestration: ask the adapter, decide whether the answer is fresh or
 * stale, remember it, and report the contact.
 *
 * THE THREE OUTCOMES
 * ------------------
 *   SUCCEEDED        — the MES was reached; the snapshot is CURRENT
 *   SUCCEEDED_STALE  — the MES was not reached, but a last known-good
 *                      exists and is within the freshness window
 *   FAILED           — the MES was not reached and there is nothing to
 *                      serve, or the MES answered something unusable
 *
 * A union, never a thrown error for an expected condition. An unreachable
 * MES is a NORMAL condition of this product — BRD FR-20 requires the
 * station to keep working through one — and modelling it as an exception
 * would make every caller handle it, and the caller that forgot would turn
 * a recoverable outage into an outage with a crash on top.
 *
 * AND THE `FAILED` BRANCH CARRIES NO SNAPSHOT
 * --------------------------------------------
 * That is the expression of the story's hardest edge case: *"the MES is
 * unreachable and there is no prior snapshot at all — the read fails loudly
 * with the error and there is no fallback content — an empty queue is never
 * substituted for 'unknown'."* An empty queue and an unreachable MES are
 * different facts, and the union keeps them apart.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { BatchEligibilityRule } from './batch-eligibility-rule.js';
import { SnapshotCache } from './snapshot-cache.js';
import { BatchQueueSnapshot, ReleasedBatch } from '../entities/snapshots.js';
import {
  BatchId,
  MachineRef,
  OrderRef,
  ShadeCode,
} from '../value-objects/identifiers.js';
import { isBatchWeighingStatus } from '../value-objects/batch-weighing-status.js';
import {
  CURRENT,
  stale,
  type SnapshotFreshness,
} from '../value-objects/snapshot-freshness.js';
import {
  AdapterError,
  type BatchStatusFilter,
  type OrgatexAdapter,
  type RawBatch,
  type RawQueue,
} from '../ports/orgatex-adapter.js';
import type { OrgatexEvent } from '../events/orgatex-events.js';

/**
 * The outcome of a queue read.
 *
 * `NOT_FOUND` cannot occur here — the queue is a list, and "no batches" is
 * an empty queue, not a missing one. A recipe read is where `NOT_FOUND`
 * belongs.
 */
export type BatchQueueReadOutcome =
  | {
      readonly kind: 'SUCCEEDED';
      readonly snapshot: BatchQueueSnapshot;
      readonly freshness: SnapshotFreshness;
    }
  | {
      readonly kind: 'SUCCEEDED_STALE';
      readonly snapshot: BatchQueueSnapshot;
      readonly freshness: SnapshotFreshness;
    }
  | {
      readonly kind: 'FAILED';
      readonly reason: 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT';
      /** For the LOG, never for the client (BRD IR-09). */
      readonly message: string;
    };

export interface BatchQueueReaderOptions {
  readonly adapter: OrgatexAdapter;
  readonly cache: SnapshotCache;
  readonly clock: () => Date;
  /**
   * Which adapter produced the snapshots.
   *
   * A name, not a class — so a test can prove the attribution without
   * depending on which adapter is bound.
   */
  readonly source: string;
  /**
   * How old a last known-good may be and still be served as stale.
   *
   * Configuration, not code (BRD NFR-14): how long a queue may be trusted
   * is an operational question.
   */
  readonly freshnessWindowMs: number;
  readonly onEvent?: (event: OrgatexEvent) => void;
}

export class BatchQueueReader {
  constructor(private readonly options: BatchQueueReaderOptions) {}

  /**
   * Read the released batch queue.
   *
   * @param filter  Optional status filter (BRD IR-01).
   */
  async read(filter?: BatchStatusFilter): Promise<BatchQueueReadOutcome> {
    const { adapter, cache, clock, source } = this.options;

    let raw: RawQueue;
    try {
      raw = await adapter.readQueue(filter);
    } catch (error) {
      return this.onFailure(error);
    }

    let snapshot: BatchQueueSnapshot;
    try {
      snapshot = this.buildSnapshot(raw, filter);
    } catch (error) {
      // A malformed record is a FAILED read, not a crash — and it fails
      // the WHOLE read (S-24). A snapshot missing one batch is a wrong
      // work list to the operator.
      return this.onFailure(
        new AdapterError(
          'MALFORMED',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    // The snapshot is remembered BEFORE the outcome is decided, so a
    // later failure can serve it.
    cache.rememberQueue(snapshot);

    this.emit({
      type: 'BATCH_QUEUE_READ',
      batchCount: snapshot.count,
      receivedAt: snapshot.receivedAt.toDate(),
      source,
      filter: filter ?? null,
    });

    return { kind: 'SUCCEEDED', snapshot, freshness: CURRENT };
  }

  /**
   * Handle a contact that did not produce a snapshot.
   *
   * The `DEGRADED` rule, in full: a stale snapshot is served only when a
   * previous good snapshot exists **and** it is within the freshness
   * window.
   *
   * The second condition is the one that is easy to miss. A snapshot taken
   * before the link went down is still the best information available, and
   * serving it marked with its age is exactly what FR-20 asks for. But a
   * snapshot taken before a DIFFERENT outage, an hour ago, from a link that
   * had already been failing, is not "the last successful snapshot" — it is
   * an old one. The freshness window bounds how old that may be.
   */
  private onFailure(error: unknown): BatchQueueReadOutcome {
    const { cache, clock, source } = this.options;

    const reason =
      error instanceof AdapterError &&
      (error.reason === 'UNREACHABLE' ||
        error.reason === 'MALFORMED' ||
        error.reason === 'TIMEOUT')
        ? error.reason
        : 'UNREACHABLE';

    const message = error instanceof Error ? error.message : String(error);

    this.emit({
      type: 'BATCH_QUEUE_READ_FAILED',
      reason,
      at: clock(),
      message,
    });

    const cached = cache.recallQueue();
    if (cached === null) {
      return { kind: 'FAILED', reason, message };
    }

    const ageMs = clock().getTime() - cached.receivedAt.toDate().getTime();
    if (ageMs > this.options.freshnessWindowMs) {
      // Too old to serve. The read fails loudly rather than showing a
      // schedule from an hour ago.
      return { kind: 'FAILED', reason, message };
    }

    return {
      kind: 'SUCCEEDED_STALE',
      snapshot: cached,
      freshness: stale(ageMs),
    };
  }

  /**
   * Build the snapshot from the MES's raw payload.
   *
   * EVERY record is validated, and one bad record fails the whole read.
   */
  private buildSnapshot(
    raw: RawQueue,
    filter: BatchStatusFilter | undefined,
  ): BatchQueueSnapshot {
    const { clock, source } = this.options;

    if (!Array.isArray(raw.batches)) {
      throw new Error('The MES returned a queue with no batch list');
    }

    const batches = raw.batches.map((batch) => this.buildBatch(batch));

    // The MES's own filter is honoured, and it is ALSO applied here. The
    // MES may not have applied it — and the operator asked for a filtered
    // queue. A filter the MES ignored must not silently widen the answer.
    const filtered =
      filter === undefined
        ? batches
        : batches.filter((batch) => batch.weighingStatus === filter);

    return new BatchQueueSnapshot(
      filtered,
      Instant.of(clock()),
      source,
    );
  }

  /** Build one batch, refusing anything the seam does not understand. */
  private buildBatch(raw: RawBatch): ReleasedBatch {
    if (!isBatchWeighingStatus(raw.weighingStatus)) {
      throw new Error(
        `Unknown weighing status "${raw.weighingStatus}" on batch ${raw.batchId}`,
      );
    }
    if (!Number.isInteger(raw.componentCount) || raw.componentCount < 0) {
      throw new Error(
        `Invalid component count on batch ${raw.batchId}`,
      );
    }

    const batchId = BatchId.create(raw.batchId);
    return new ReleasedBatch(
      batchId,
      OrderRef.create(raw.orderRef),
      MachineRef.create(raw.machineRef),
      raw.fabricDescription,
      ShadeCode.create(raw.shadeCode),
      raw.componentCount,
      raw.weighingStatus,
      BatchEligibilityRule.evaluate(raw.weighingStatus),
    );
  }

  private emit(event: OrgatexEvent): void {
    this.options.onEvent?.(event);
  }
}
