/**
 * BatchQueueFilter — the pure mapping from a queue and a filter onto a
 * view.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO CLOCK, NO ADAPTER, NO CACHE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The filter is a **pure function of two inputs**: a queue and a filter.
 * It has no state, no persistence and no external contract — which is why
 * it is a service inside this unit rather than a unit of its own, the same
 * argument that kept the tolerance engine inside unit 003.
 *
 * WHY THE FILTERED VIEW KEEPS THE QUEUE'S RECEIPT TIME
 * ----------------------------------------------------
 * The story is explicit:
 *
 * > "The filtered view must not be mistaken for a separate queue:
 * > `receivedAt` remains visible and unchanged while a filter is applied, so
 * > the operator can still see how old the underlying data is."
 *
 * So the filtered queue is the **same queue** with fewer rows — same
 * `receivedAt`, same `source`, same `freshness`. Only the rows change.
 *
 * WHY THE OFFERED STATUSES COME FROM THE UNFILTERED QUEUE
 * ---------------------------------------------------------
 * If they came from the *filtered* rows, then applying a filter would
 * shrink the option set to the one status being filtered by — and the
 * control would become a one-way door, with no way for the operator to
 * widen the queue again.
 *
 * So `statusesIn` is always called on the **unfiltered** queue (ADR-030).
 */
import {
  StationBatchQueue,
} from '../entities/station-batch-queue.js';
import type {
  FilterableStatuses,
  QueueFilter,
} from '../value-objects/queue-filter.js';
import type { BatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';

export class BatchQueueFilter {
  /**
   * Narrow a queue by status.
   *
   * @param queue  The queue to filter.
   * @param filter The status to narrow by, or `null` for "All".
   * @returns A **new** queue with the matching rows and the **same**
   *          receipt time, source and freshness. The input is untouched.
   */
  filter(
    queue: StationBatchQueue,
    filter: QueueFilter,
  ): StationBatchQueue {
    if (filter === null) {
      return queue;
    }

    const batches = queue.batches.filter(
      (batch) => batch.weighingStatus === filter,
    );

    return new StationBatchQueue(
      batches,
      queue.receivedAt,
      queue.source,
      queue.freshness,
    );
  }

  /**
   * The statuses present in a queue, in the order they appear.
   *
   * **Distinct**, and in the **MES's order** — not alphabetically and not
   * in the order of first appearance. The order the statuses appear in the
   * queue's rows is the order the operator already sees; sorting them
   * would be the domain inventing an order the MES did not give.
   */
  statusesIn(queue: StationBatchQueue): FilterableStatuses {
    const seen = new Set<BatchWeighingStatus>();
    const statuses: BatchWeighingStatus[] = [];

    for (const batch of queue.batches) {
      if (seen.has(batch.weighingStatus)) continue;
      seen.add(batch.weighingStatus);
      statuses.push(batch.weighingStatus);
    }

    return statuses;
  }
}
