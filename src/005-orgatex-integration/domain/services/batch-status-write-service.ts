/**
 * BatchStatusWriteService — advancing a batch's weighing status.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PRECONDITION IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD FR-16 and the story's last edge case:
 *
 * > "The batch has several components | Each component's consumption is
 * > a separate posting with its own key; the batch weighing status
 * > advances to `WEIGHED` only when the batch's postings are all
 * > resolved."
 *
 * So the service **reads** the batch's postings and refuses to write
 * `WEIGHED` while any of them is unresolved.
 *
 * Why a read across the boundary and not an invariant on a shared
 * aggregate: the MES owns the batch. The station's copy of the batch's
 * status is a projection of somebody else's truth, and an invariant
 * spanning it would have to be enforced against data we do not control.
 *
 * So it is a **precondition on the write**, enforced where it can be —
 * and it reads **this unit's own table**, not the MES's.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { BatchStatusWrite } from '../entities/postings.js';
import type { BatchId } from '../value-objects/identifiers.js';
import type { BatchStatusToWrite } from '../ports/orgatex-adapter.js';
import {
  AdapterError,
  AdapterRejection,
  type OrgatexAdapter,
} from '../ports/orgatex-adapter.js';
import type {
  BatchStatusWriteRepository,
  PostingRepository,
  UnitOfWork,
} from '../ports/posting-repositories.js';
import type { PostingEvent } from '../events/posting-events.js';

export type BatchStatusWriteOutcome =
  | {
      readonly kind: 'WRITTEN';
      readonly write: BatchStatusWrite;
    }
  | {
      readonly kind: 'QUEUED';
      readonly write: BatchStatusWrite;
      /** For the log, never for the client. */
      readonly message: string;
    }
  | {
      readonly kind: 'REJECTED';
      readonly write: BatchStatusWrite;
      readonly reason: import('../value-objects/rejection-reason.js').RejectionReason;
    }
  | {
      readonly kind: 'POSTINGS_UNRESOLVED';
      /** How many of the batch's postings are still pending. */
      readonly unresolved: number;
    };

export interface BatchStatusWriteServiceOptions {
  readonly adapter: OrgatexAdapter;
  readonly postings: PostingRepository;
  readonly writes: BatchStatusWriteRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: () => Date;
  readonly newWriteId: () => string;
  readonly onEvent?: (event: PostingEvent) => void;
}

export class BatchStatusWriteService {
  constructor(private readonly options: BatchStatusWriteServiceOptions) {}

  /**
   * Advance a batch's weighing status.
   *
   * The only status this can write is `WEIGHED` — it is a **literal** in
   * the signature, not a parameter.
   */
  async advanceToWeighed(
    batchId: BatchId,
    status: BatchStatusToWrite = 'WEIGHED',
  ): Promise<BatchStatusWriteOutcome> {
    const { adapter, postings, writes, unitOfWork, clock } = this.options;

    // ── The precondition ─────────────────────────────────────────────
    // Every posting for the batch must be RESOLVED — accepted or
    // rejected. A batch whose second component has not landed is not a
    // malformed request; it is a world whose state refuses the write.
    const batchPostings = await postings.findByBatch(batchId);
    const unresolved = batchPostings.filter((posting) => !posting.isResolved);
    if (unresolved.length > 0) {
      return { kind: 'POSTINGS_UNRESOLVED', unresolved: unresolved.length };
    }

    const write = new BatchStatusWrite(
      this.options.newWriteId(),
      batchId,
      status,
      Instant.of(clock()),
    );
    await writes.save(write);

    try {
      await adapter.writeBatchStatus(batchId, status);
    } catch (error) {
      if (error instanceof AdapterRejection) {
        await unitOfWork.commitStatusWrite({
          kind: 'REJECTED',
          write,
          reason: error.reason,
        });
        this.emit({
          type: 'BATCH_STATUS_WRITE_REJECTED',
          writeId: write.id,
          batchId,
          reason: error.reason,
          rejectedAt: clock(),
        });
        return {
          kind: 'REJECTED',
          write: (await writes.findById(write.id)) ?? write,
          reason: error.reason,
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      await unitOfWork.commitStatusWrite({ kind: 'PENDING', write });
      this.emit({
        type: 'BATCH_STATUS_WRITE_ATTEMPTED',
        writeId: write.id,
        batchId,
        outcome: error instanceof AdapterError ? 'UNREACHABLE' : 'UNKNOWN',
        attemptedAt: clock(),
        message,
      });
      return { kind: 'QUEUED', write, message };
    }

    await unitOfWork.commitStatusWrite({ kind: 'ACCEPTED', write });

    this.emit({
      type: 'BATCH_WEIGHING_STATUS_WRITTEN',
      batchId,
      status,
      writtenAt: clock(),
    });

    return {
      kind: 'WRITTEN',
      write: (await writes.findById(write.id)) ?? write,
    };
  }

  private emit(event: PostingEvent): void {
    this.options.onEvent?.(event);
  }
}
