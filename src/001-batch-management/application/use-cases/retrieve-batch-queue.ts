/**
 * RetrieveBatchQueue — the read use case.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONLY PLACE THE TWO UNITS MEET.
 * ══════════════════════════════════════════════════════════════════════
 *
 * It holds a **port**, not an adapter. It never holds a `BatchQueueReader`
 * class, an `OrgatexAdapter`, a credential or a socket — so there is
 * exactly one reader of the MES seam, and the composition root is the one
 * place the two units are bound (ADR-028).
 *
 * IT HOLDS NO CACHE
 * -----------------
 * Unit 005's reader owns the cache and the link state, and therefore owns
 * whether what it returns is current. A cache here would be a **second
 * source of truth** for the same queue — the exact duplication the unit
 * brief forbids and ADR-021 warns about.
 *
 * IT HOLDS NO CLOCK
 * -----------------
 * The receipt time is unit 005's fact, carried on the snapshot. A clock
 * here would let the projection report the render time, and the story is
 * explicit that `receivedAt` must be the **upstream receipt** time.
 *
 * THE FILTER IS A VIEW, AND IT IS APPLIED HERE
 * -------------------------------------------
 * Bolt 009 added the filter to this use case, and it is applied in **one**
 * place: after the projection, on the station's own rows.
 *
 * That ordering is deliberate. The filter is applied three times over the
 * whole read — once by the MES (which may honour it), once by unit 005's
 * reader (which does not trust the MES to have done so), and once here —
 * and the third application is the one that matters for **this unit's**
 * correctness: the rows this unit publishes must be the filtered ones, and
 * that must not depend on a fact about somebody else's implementation.
 *
 * A filter that matches nothing is still an `AVAILABLE` queue with zero
 * rows. It is **not** an error, and it is **not** an `UNAVAILABLE` queue
 * (FR-1): "no batches match this filter" is an explicit state, and the
 * availability of the queue is a separate question from how many rows the
 * filter leaves.
 */
import type { BatchQueueSource } from '../../domain/ports/batch-queue-source.js';
import { BatchQueueProjector } from '../../domain/services/batch-queue-projector.js';
import { BatchQueueFilter } from '../../domain/services/batch-queue-filter.js';
import type {
  QueueAvailability,
  QueueUnavailableReason,
} from '../../domain/value-objects/queue-availability.js';
import type { BatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import type { BatchQueueSnapshot } from '../../../005-orgatex-integration/domain/entities/snapshots.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';

export interface RetrieveBatchQueueOptions {
  /** The seam this unit reads through. */
  readonly source: BatchQueueSource;
  /** The projection. Injected so it can be replaced in a test. */
  readonly projector?: BatchQueueProjector;
  /** The filter. Injected so it can be replaced in a test. */
  readonly filter?: BatchQueueFilter;
  /**
   * Where a failure's diagnostic goes.
   *
   * The **detail** never reaches the client (BRD IR-09): the API response
   * carries the reason code and nothing else. The detail goes here, so it
   * can be diagnosed without OrgaTEX-side access.
   */
  readonly onError?: (detail: string) => void;
}

export class RetrieveBatchQueue {
  private readonly projector: BatchQueueProjector;
  private readonly filter: BatchQueueFilter;

  constructor(private readonly options: RetrieveBatchQueueOptions) {
    this.projector = options.projector ?? new BatchQueueProjector();
    this.filter = options.filter ?? new BatchQueueFilter();
  }

  /**
   * Read the released batch queue.
   *
   * @param status The status to narrow by, or `null` for "All".
   * @returns `AVAILABLE` with the filtered queue and the statuses the
   *          operator may filter to, or `UNAVAILABLE` with the reason and
   *          the diagnostic.
   */
  async execute(
    status: BatchWeighingStatus | null = null,
  ): Promise<QueueAvailability> {
    // THE WHOLE QUEUE IS READ, AND THE FILTER IS APPLIED HERE.
    //
    // The filter is deliberately NOT pushed into the seam. Two reasons,
    // and the second one is a correctness bug:
    //
    //   1. the statuses the operator may filter TO must come from the
    //      whole queue — otherwise applying a filter would collapse the
    //      option set to the one status being filtered by, and the
    //      control would become a one-way door (ADR-030);
    //
    //   2. unit 005's reader CACHES the snapshot it built. A filtered
    //      read would put a filtered queue into that cache, and the
    //      reader's DEGRADED fallback would later serve the partial
    //      queue as though it were the whole released schedule.
    //
    // So the filter is a VIEW over the whole queue, and the view is
    // built here, on this unit's own rows.
    const outcome = await this.options.source.read();

    switch (outcome.kind) {
      case 'SUCCEEDED':
        return this.available(outcome.snapshot, outcome.freshness, status);

      case 'SUCCEEDED_STALE':
        // Unit 005 has already decided this snapshot is serveable. The
        // staleness travels with the queue inside `freshness`; this unit
        // does not re-decide it (ADR-028).
        return this.available(outcome.snapshot, outcome.freshness, status);

      case 'FAILED':
        // The diagnostic goes to the log. The client gets the reason code
        // and nothing else — and it gets **no queue at all**, so an empty
        // queue can never be mistaken for an authoritative one.
        this.options.onError?.(
          `[batch-queue] the released queue is unavailable (${outcome.reason}): ${outcome.message}`,
        );
        return {
          kind: 'UNAVAILABLE',
          reason: outcome.reason as QueueUnavailableReason,
          message: outcome.message,
        };
    }
  }

  /**
   * Project, read the option set, and apply the filter.
   *
   * The statuses come from the queue **before** the filter is applied — if
   * they came from the filtered rows, the filter control would offer only
   * the status being filtered by, and the operator could narrow the queue
   * and never widen it again (ADR-030).
   */
  private available(
    snapshot: BatchQueueSnapshot,
    freshness: SnapshotFreshness,
    status: BatchWeighingStatus | null,
  ): QueueAvailability {
    const queue = this.projector.project(snapshot, freshness);

    return {
      kind: 'AVAILABLE',
      queue: this.filter.filter(queue, status),
      statuses: this.filter.statusesIn(queue),
    };
  }
}
