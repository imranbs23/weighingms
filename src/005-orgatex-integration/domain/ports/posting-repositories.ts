/**
 * The four repository ports of the write path.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ABSENT METHODS ARE THE ENFORCEMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every rule about what may change is expressed by a method that does
 * **not** exist:
 *
 * | Repository | Absent | The rule it enforces |
 * |---|---|---|
 * | `IdempotencyLedger` | `delete` | A consumed key is consumed forever (DR-01) |
 * | `PostingRepository` | `update` | The posting's content is immutable (ADR-024) |
 * | `PostingAttemptRepository` | `update`, `delete` | The attempts are append-only |
 * | `BatchStatusWriteRepository` | `update` | Only the outcome may move |
 *
 * A repository with no `update` cannot be used to mutate a record. That
 * is stronger than a convention, and it is stronger than a code review.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { ConsumptionPosting } from '../entities/postings.js';
import type { PostingAttempt } from '../entities/postings.js';
import type { BatchStatusWrite } from '../entities/postings.js';
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { BatchId } from '../value-objects/identifiers.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

/**
 * The unit of work.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE THREE WRITES THAT MUST NOT DISAGREE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The posting, the attempt and (on acceptance) the ledger entry are
 * three writes with a shared fate:
 *
 * - A ledger entry without its posting → a retry is refused as a
 *   duplicate and the consumption is **never sent**.
 * - A posting without its attempt → the attempt history has a hole, and
 *   IR-09's diagnosis is weaker.
 * - An attempt without its posting → a dangling reference.
 *
 * So they go in **one transaction**. The domain asks for that with one
 * method — `commit` — rather than three, because three calls with three
 * commits is exactly the shape that produces the disagreements above.
 *
 * The port is in the **domain** because the rule is a business rule: the
 * posting and its ledger entry are one fact, and one fact is committed
 * once. `node:sqlite` is the implementation, not the requirement.
 */
export interface UnitOfWork {
  /**
   * Commit the posting, the attempt and — on acceptance — the ledger
   * entry together.
   *
   * @throws when the ledger's primary key rejects the key. That
   *         violation **is** the duplicate refusal, and it is the
   *         atomic one (ADR-023).
   */
  commit(change: PostingCommit): Promise<void>;

  /**
   * Commit a batch status write and its outcome together.
   *
   * The write row and its state transition are two writes with a shared
   * fate: a row left `QUEUED` after the MES accepted it would look
   * like a pending write, and a row marked `ACCEPTED` with no row would
   * be a dangling reference.
   */
  commitStatusWrite(change: StatusWriteCommit): Promise<void>;
}

/**
 * A status write's outcome.
 */
export type StatusWriteCommit =
  | {
      readonly kind: 'ACCEPTED';
      readonly write: BatchStatusWrite;
    }
  | {
      readonly kind: 'REJECTED';
      readonly write: BatchStatusWrite;
      readonly reason: RejectionReason;
    }
  | {
      readonly kind: 'PENDING';
      readonly write: BatchStatusWrite;
    };

/**
 * The change a unit of work commits.
 *
 * A discriminated union, because the three writes are not optional in
 * the same way: an **accepted** posting always has an attempt and a
 * ledger entry, and a posting that was never sent has a posting and an
 * attempt but no ledger entry.
 */
export type PostingCommit =
  | {
      readonly kind: 'ACCEPTED';
      readonly posting: ConsumptionPosting;
      readonly attempt: PostingAttempt;
      readonly ledgerKey: IdempotencyKey;
      readonly ledgerAt: Instant;
    }
  | {
      readonly kind: 'REJECTED';
      readonly posting: ConsumptionPosting;
      readonly attempt: PostingAttempt;
    }
  | {
      readonly kind: 'PENDING';
      readonly posting: ConsumptionPosting;
      readonly attempt: PostingAttempt;
    };

/**
 * The idempotency ledger — the deduplication index.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PRIMARY KEY IS THE GUARANTEE. (ADR-023)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The implementation's table has `idempotency_key` as its PRIMARY KEY,
 * so the uniqueness constraint **is** the guard. There is no
 * check-then-write window, and two concurrent submissions of the same
 * key cannot both be admitted.
 *
 * `record` therefore **throws** on a duplicate — it does not return a
 * boolean. A boolean would let a caller treat "the insert did not
 * happen" as a soft outcome, and the caller would have to remember what
 * to do about it.
 *
 * THE LEDGER IS ONLY WRITTEN WHEN A POSTING IS ACCEPTED
 * -----------------------------------------------------
 * A `QUEUED` posting's key is not here — it is in the sync queue that
 * bolt 007 owns. The ledger holds exactly the keys that may never be
 * used again.
 */
export interface IdempotencyLedger {
  /** Is this key already consumed? */
  has(key: IdempotencyKey): Promise<boolean>;

  /**
   * Record that a key has been consumed.
   *
   * @throws when the key is already present — the duplicate refusal.
   */
  record(key: IdempotencyKey, postingId: IdempotencyKey, at: Instant): Promise<void>;

  /** The posting this key was recorded for, or null. */
  find(key: IdempotencyKey): Promise<IdempotencyKey | null>;
}

/**
 * The postings.
 *
 * No general `update`. The only mutations are `markAccepted` and
 * `markRejected`, and both are guarded by `WHERE state = 'QUEUED'` — so
 * a double-resolution affects zero rows and **raises**.
 */
export interface PostingRepository {
  /** Insert a posting. Fails if the key is already present. */
  save(posting: ConsumptionPosting): Promise<void>;

  findById(id: IdempotencyKey): Promise<ConsumptionPosting | null>;

  /** Every posting for a batch, in creation order. */
  findByBatch(batchId: BatchId): Promise<ConsumptionPosting[]>;

  /**
   * Mark a posting accepted.
   *
   * @throws when the posting is not `QUEUED` — the double-resolution.
   */
  markAccepted(id: IdempotencyKey, at: Instant): Promise<void>;

  /**
   * Mark a posting rejected, with its reason.
   *
   * @throws when the posting is not `QUEUED`.
   */
  markRejected(id: IdempotencyKey, reason: RejectionReason, at: Instant): Promise<void>;
}

/**
 * The attempt history.
 *
 * APPEND-ONLY. There is no `update` and no `delete`.
 */
export interface PostingAttemptRepository {
  /** Append one attempt. */
  append(attempt: PostingAttempt): Promise<void>;

  /** Every attempt for a posting, oldest first. */
  findByPosting(postingId: IdempotencyKey): Promise<PostingAttempt[]>;
}

/**
 * The batch status writes.
 *
 * One row per write attempt. This holds what **we wrote** — it is not a
 * mirror of what the MES holds.
 */
export interface BatchStatusWriteRepository {
  save(write: BatchStatusWrite): Promise<void>;

  findById(id: string): Promise<BatchStatusWrite | null>;

  /** Every status write for a batch, oldest first. */
  findByBatch(batchId: BatchId): Promise<BatchStatusWrite[]>;

  markAccepted(id: string, at: Instant): Promise<void>;

  markRejected(id: string, reason: RejectionReason, at: Instant): Promise<void>;
}
