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
 * explicit that `receivedAt` is the **upstream receipt** time.
 */
import type { BatchQueueSource } from '../../domain/ports/batch-queue-source.js';
import { BatchQueueProjector } from '../../domain/services/batch-queue-projector.js';
import type {
  QueueAvailability,
  QueueUnavailableReason,
} from '../../domain/value-objects/queue-availability.js';

export interface RetrieveBatchQueueOptions {
  /** The seam this unit reads through. */
  readonly source: BatchQueueSource;
  /** The projection. Injected so it can be replaced in a test. */
  readonly projector?: BatchQueueProjector;
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

  constructor(private readonly options: RetrieveBatchQueueOptions) {
    this.projector = options.projector ?? new BatchQueueProjector();
  }

  /**
   * Read the released batch queue.
   *
   * @returns `AVAILABLE` with the projected queue, or `UNAVAILABLE` with
   *          the reason and the diagnostic.
   */
  async execute(): Promise<QueueAvailability> {
    const outcome = await this.options.source.read();

    switch (outcome.kind) {
      case 'SUCCEEDED':
        return {
          kind: 'AVAILABLE',
          queue: this.projector.project(outcome.snapshot, outcome.freshness),
        };

      case 'SUCCEEDED_STALE':
        // Unit 005 has already decided this snapshot is serveable. The
        // staleness travels with the queue inside `freshness`; this unit
        // does not re-decide it (ADR-028).
        return {
          kind: 'AVAILABLE',
          queue: this.projector.project(outcome.snapshot, outcome.freshness),
        };

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
}
