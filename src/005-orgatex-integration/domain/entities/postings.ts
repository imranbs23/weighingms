/**
 * ConsumptionPosting, PostingAttempt and BatchStatusWrite — the write
 * side's records.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE POSTING'S CONTENT IS IMMUTABLE. (ADR-024)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The content — batch, component, quantity, unit, lot, operator,
 * weighed-at — is written once and never again. Only the **outcome**
 * may change, and only once, and only from `QUEUED`.
 *
 * The content describes something that physically happened: 94.01 g of
 * DYE-4471 was dispensed at 08:14:22 by operator OP-001. That event
 * does not change. If the row's quantity disagrees with the weighing
 * record it describes, one of the two is wrong — and the weighing
 * record is the source of truth.
 *
 * So this entity has no `update` method, and its repository has no
 * general `update` method either. The only mutations are `accept` and
 * `reject`, and the repository guards both with `WHERE state =
 * 'QUEUED'` so a double-resolution is impossible.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../value-objects/identifiers.js';
import { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { PostingState } from '../value-objects/posting-state.js';
import type { AttemptOutcome } from '../value-objects/posting-state.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

/**
 * One intended write of what was dispensed.
 *
 * The `id` **is** the idempotency key. That is not a convenience — it
 * is the mechanism. The key is derived from the weighing record's
 * identity, so a retry of the same weighing reuses it and a second
 * weighing of the same component does not.
 */
export class ConsumptionPosting {
  constructor(
    readonly id: IdempotencyKey,
    readonly batchId: BatchId,
    readonly componentId: ComponentId,
    readonly actualQuantity: WeightValue,
    readonly lotNumber: LotNumber,
    readonly operatorId: OperatorReference,
    readonly weighedAt: Instant,
    readonly createdAt: Instant,
    readonly state: PostingState = 'QUEUED',
    readonly rejection: RejectionReason | null = null,
  ) {}

  /** Is this posting resolved — accepted or rejected? */
  get isResolved(): boolean {
    return this.state === 'ACCEPTED' || this.state === 'REJECTED';
  }

  /** Is this posting still pending? */
  get isPending(): boolean {
    return this.state === 'QUEUED';
  }

  /**
   * The accepted posting.
   *
   * The state only ever moves from `QUEUED`, so this is the **only**
   * transition into `ACCEPTED`. A second call would be a double
   * resolution — the repository's guarded update catches it and raises.
   */
  accept(at: Instant): ConsumptionPosting {
    if (this.state !== 'QUEUED') {
      throw new Error(
        `A posting in state ${this.state} cannot be accepted — the transition is QUEUED to ACCEPTED only`,
      );
    }
    return new ConsumptionPosting(
      this.id,
      this.batchId,
      this.componentId,
      this.actualQuantity,
      this.lotNumber,
      this.operatorId,
      this.weighedAt,
      this.createdAt,
      'ACCEPTED',
      null,
    );
  }

  /**
   * The rejected posting.
   *
   * The reason is **retained on the posting**, not only on the attempt.
   * That is what makes the retained failed entry self-describing: an
   * operator looking at it sees why it failed, without joining to
   * another table.
   */
  reject(reason: RejectionReason): ConsumptionPosting {
    if (this.state !== 'QUEUED') {
      throw new Error(
        `A posting in state ${this.state} cannot be rejected — the transition is QUEUED to REJECTED only`,
      );
    }
    return new ConsumptionPosting(
      this.id,
      this.batchId,
      this.componentId,
      this.actualQuantity,
      this.lotNumber,
      this.operatorId,
      this.weighedAt,
      this.createdAt,
      'REJECTED',
      reason,
    );
  }
}

/**
 * One try to deliver a posting.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE. EVER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The attempt records what happened **at that attempt**. The posting
 * records how it ended. A posting rejected on its third attempt has two
 * `REJECTED` attempts and one final rejection — and the count of the
 * attempts is diagnostic information the story's edge case about a
 * permanently failed posting needs.
 *
 * Its outcome may be `UNKNOWN` or `UNREACHABLE`, which the posting's
 * state may not be.
 */
export class PostingAttempt {
  constructor(
    readonly id: string,
    readonly postingId: IdempotencyKey,
    readonly attemptedAt: Instant,
    readonly outcome: AttemptOutcome,
    readonly reason: RejectionReason | null = null,
  ) {}
}

/**
 * A write of exactly one OrgaTEX batch field — the weighing status.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NO OTHER ORGATEX BATCH FIELD IS EVER ALTERED. (BRD IR-06, C-01)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The adapter's method takes a **status**, not a batch. There is no
 * parameter through which another OrgaTEX field could be changed, so a
 * future caller cannot change one by accident.
 *
 * This entity holds what **we wrote** — it is not a mirror of what the
 * MES holds.
 */
export class BatchStatusWrite {
  constructor(
    readonly id: string,
    readonly batchId: BatchId,
    readonly status: BatchWeighingStatus,
    readonly writtenAt: Instant,
    readonly state: PostingState = 'QUEUED',
    readonly rejection: RejectionReason | null = null,
  ) {}

  get isResolved(): boolean {
    return this.state === 'ACCEPTED' || this.state === 'REJECTED';
  }
}

/** The only status this seam writes. */
export type BatchWeighingStatus = 'WEIGHED';
