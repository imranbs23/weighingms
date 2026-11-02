/**
 * The posting path's domain events.
 *
 * ══════════════════════════════════════════════════════════════════════
 * AN ATTEMPT EVENT AND AN OUTCOME EVENT ARE NOT REDUNDANT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The **attempt** event fires on every attempt, including the ones that
 * establish nothing. The **outcome** event fires only on a **definitive**
 * answer from the MES.
 *
 * So a caller that wants "what happened?" subscribes to the attempt
 * event; a caller that wants "what is the state?" reads the posting.
 *
 * There is deliberately no event for "the posting was created" — a
 * creation is not an interaction with the MES, and bolt 007's link-state
 * machine counts *contacts*, not intentions.
 */
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { BatchId } from '../value-objects/identifiers.js';
import type { ComponentId } from '../value-objects/identifiers.js';
import type { AttemptOutcome } from '../value-objects/posting-state.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

export interface ConsumptionPostingAccepted {
  readonly type: 'CONSUMPTION_POSTING_ACCEPTED';
  readonly postingId: IdempotencyKey;
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly acceptedAt: Date;
}

export interface ConsumptionPostingRejected {
  readonly type: 'CONSUMPTION_POSTING_REJECTED';
  readonly postingId: IdempotencyKey;
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly reason: RejectionReason;
  readonly rejectedAt: Date;
}

export interface ConsumptionPostingAttempted {
  readonly type: 'CONSUMPTION_POSTING_ATTEMPTED';
  readonly postingId: IdempotencyKey;
  readonly outcome: AttemptOutcome;
  readonly attemptedAt: Date;
  /** For the LOG, never for the client (BRD IR-09). */
  readonly message: string;
}

export interface BatchWeighingStatusWritten {
  readonly type: 'BATCH_WEIGHING_STATUS_WRITTEN';
  readonly batchId: BatchId;
  readonly status: 'WEIGHED';
  readonly writtenAt: Date;
}

export interface BatchStatusWriteRejected {
  readonly type: 'BATCH_STATUS_WRITE_REJECTED';
  readonly writeId: string;
  readonly batchId: BatchId;
  readonly reason: RejectionReason;
  readonly rejectedAt: Date;
}

export interface BatchStatusWriteAttempted {
  readonly type: 'BATCH_STATUS_WRITE_ATTEMPTED';
  readonly writeId: string;
  readonly batchId: BatchId;
  readonly outcome: AttemptOutcome;
  readonly attemptedAt: Date;
  /** For the LOG, never for the client (BRD IR-09). */
  readonly message: string;
}

export type PostingEvent =
  | ConsumptionPostingAccepted
  | ConsumptionPostingRejected
  | ConsumptionPostingAttempted
  | BatchWeighingStatusWritten
  | BatchStatusWriteRejected
  | BatchStatusWriteAttempted;
