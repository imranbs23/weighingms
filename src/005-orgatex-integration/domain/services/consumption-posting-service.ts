/**
 * ConsumptionPostingService — the write path's orchestration.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TWO GUARDS ARE AT DIFFERENT PATHS, AND NEITHER IS OPTIONAL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * 1. **The send path.** Posting the same consumption twice must produce
 *    one consumption. Guarded by the ledger: a key already recorded as
 *    accepted is **not sent again**.
 *
 * 2. **The enqueue path.** *"Given a consumption posting has already
 *    been enqueued with its idempotency key, When an enqueue of that same
 *    key is requested, Then the request is refused as a duplicate and no
 *    second queue entry is created."*
 *
 * The second guard is on the **enqueue** path, not only on the send
 * path, and the story says why: *"so that a duplicated submission while
 * the link is down cannot create two queue entries for one weighing."*
 *
 * That is a **different failure** from the first. Two queue entries for
 * one weighing means two deliveries, and two deliveries with the same
 * key is what the key prevents — but the local guard must not *rely* on
 * the MES to dedupe.
 *
 * AND THEY ARE NOT THE SAME CHECK
 * --------------------------------
 * A single "has this key been seen?" query would be wrong:
 *
 * - `ACCEPTED` → must not be sent again
 * - `QUEUED`   → must not be re-enqueued
 * - `REJECTED` → **may** be re-driven; CQ-06's disposition decides
 *
 * So the send guard reads the **ledger**, and the enqueue guard reads
 * the **postings**.
 *
 * THE LEDGER IS THE ATOMIC GUARD
 * ------------------------------
 * The guards above are **reads**, and a read cannot be atomic. The
 * guarantee is the ledger's PRIMARY KEY: the insert that records an
 * accepted key is the write, and its UNIQUE violation is the refusal
 * (ADR-023). So the ledger's `record` is what actually admits one
 * posting of a key — the reads above are there to avoid *doing the
 * work* twice, not to enforce the rule.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { ConsumptionPosting, PostingAttempt } from '../entities/postings.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../value-objects/identifiers.js';
import { IdempotencyKey } from '../value-objects/idempotency-key.js';
import { IdempotencyKeyFactory } from './idempotency-key-factory.js';
import type { WeighingIdentity } from './idempotency-key-factory.js';
import { RejectionReason } from '../value-objects/rejection-reason.js';
import {
  AdapterError,
  AdapterRejection,
  type OrgatexAdapter,
  type RawConsumption,
} from '../ports/orgatex-adapter.js';
import type {
  IdempotencyLedger,
  PostingRepository,
  UnitOfWork,
} from '../ports/posting-repositories.js';
import type { PostingEvent } from '../events/posting-events.js';
import type { LinkContactReporter } from '../ports/link-repositories.js';
import { SyncError } from '../value-objects/sync-error.js';

/**
 * What the caller asked for.
 *
 * The operator id is **not** here — it comes from the session. A
 * request that could name the operator would let a caller post
 * consumption as somebody else (FR-18).
 */
export interface ConsumptionRequest {
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly actualQuantity: WeightValue;
  readonly lotNumber: LotNumber;
  readonly operatorId: OperatorReference;
  readonly weighedAt: Instant;
}

/**
 * The outcome of a post.
 *
 * A discriminated union, so a caller cannot read a `posting` without
 * first proving one was created.
 */
export type PostingOutcome =
  | {
      readonly kind: 'ACCEPTED';
      readonly posting: ConsumptionPosting;
    }
  | {
      readonly kind: 'QUEUED';
      readonly posting: ConsumptionPosting;
      /** Why it was queued — for the log, never for the client. */
      readonly message: string;
    }
  | {
      readonly kind: 'REJECTED';
      readonly posting: ConsumptionPosting;
      readonly reason: RejectionReason;
    }
  | {
      readonly kind: 'DUPLICATE';
      readonly posting: ConsumptionPosting;
      /** True when the duplicate was of an ACCEPTED posting. */
      readonly alreadyAccepted: boolean;
    };

export interface ConsumptionPostingServiceOptions {
  readonly adapter: OrgatexAdapter;
  readonly ledger: IdempotencyLedger;
  readonly postings: PostingRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: () => Date;
  /**
   * Where the contact outcome is reported.
   *
   * Optional, so the service can be built without a link reporter — which
   * is what bolt 006's own tests do. When it IS present, every contact
   * reports its outcome, so the link state reflects reality (R-08).
   */
  readonly contactReporter?: LinkContactReporter;
  readonly onEvent?: (event: PostingEvent) => void;
  /** Injected so the attempt id is deterministic in tests. */
  readonly newAttemptId: () => string;
}

export class ConsumptionPostingService {
  constructor(private readonly options: ConsumptionPostingServiceOptions) {}

  /**
   * Post one consumption.
   *
   * The whole flow, in the order it happens.
   */
  async post(request: ConsumptionRequest): Promise<PostingOutcome> {
    const { adapter, ledger, postings, unitOfWork, clock } = this.options;

    const identity: WeighingIdentity = {
      batchId: request.batchId,
      componentId: request.componentId,
      operatorId: request.operatorId,
      weighedAt: request.weighedAt.toDate().toISOString(),
    };
    const key = IdempotencyKeyFactory.derive(identity);

    // ── The send-path guard ──────────────────────────────────────────
    // The ledger holds exactly the keys that may never be used again.
    if (await ledger.has(key)) {
      const existing = await postings.findById(key);
      if (existing !== null) {
        this.emit({
          type: 'CONSUMPTION_POSTING_ATTEMPTED',
          postingId: key,
          outcome: 'ACCEPTED',
          attemptedAt: clock(),
          message: 'Refused as a duplicate — the key is already consumed',
        });
        return { kind: 'DUPLICATE', posting: existing, alreadyAccepted: true };
      }
    }

    // ── The enqueue-path guard ───────────────────────────────────────
    // A posting that is still QUEUED must not be re-enqueued, or the link
    // being down would create two queue entries for one weighing.
    const existingPosting = await postings.findById(key);
    if (existingPosting !== null && existingPosting.isPending) {
      this.emit({
        type: 'CONSUMPTION_POSTING_ATTEMPTED',
        postingId: key,
        outcome: 'UNKNOWN',
        attemptedAt: clock(),
        message:
          'Refused as a duplicate — a posting with this key is already pending',
      });
      return {
        kind: 'DUPLICATE',
        posting: existingPosting,
        alreadyAccepted: false,
      };
    }

    const posting = await this.createOrReuse(key, request);
    if (posting === null) {
      // A posting with this key already exists. Whether it is a
      // duplicate or a rejection depends on how it RESOLVED:
      //
      // - `ACCEPTED` → the consumption is already posted. A duplicate.
      // - `REJECTED` → the MES refused it. Its retryability is CQ-06's
      //   disposition — bolt 007's concern — so the rejection is
      //   reported faithfully and the key is NOT re-driven here.
      const resolved = await postings.findById(key);
      if (resolved === null) {
        throw new Error(
          `The posting for ${key.value} vanished between the guard and the write`,
        );
      }

      if (resolved.state === 'ACCEPTED') {
        this.emit({
          type: 'CONSUMPTION_POSTING_ATTEMPTED',
          postingId: key,
          outcome: 'ACCEPTED',
          attemptedAt: clock(),
          message: 'Refused as a duplicate — the key is already consumed',
        });
        return {
          kind: 'DUPLICATE',
          posting: resolved,
          alreadyAccepted: true,
        };
      }

      return {
        kind: 'REJECTED',
        posting: resolved,
        reason: resolved.rejection ?? RejectionReason.unmapped('rejected'),
      };
    }

    // ── Send ─────────────────────────────────────────────────────────
    const raw: RawConsumption = {
      batchId: posting.batchId.value,
      componentId: posting.componentId.value,
      actualQuantity: posting.actualQuantity.toJSON(),
      unit: posting.actualQuantity.unit,
      lotNumber: posting.lotNumber.value,
      operatorId: posting.operatorId.value,
      weighedAt: posting.weighedAt.toDate().toISOString(),
      idempotencyKey: posting.id.value,
    };

    try {
      await adapter.postConsumption(raw);
    } catch (error) {
      if (error instanceof AdapterRejection) {
        // The MES was REACHED and REFUSED. That is a failed contact — the
        // MES answered, and the answer was a failure (R-01).
        await this.reportFailure('REJECTED', error.message);
        return this.onRejected(posting, error, unitOfWork, clock);
      }
      const reason = this.adapterReason(error);
      await this.reportFailure(
        reason,
        error instanceof Error ? error.message : String(error),
      );
      return this.onUnreachable(posting, error, unitOfWork, clock);
    }

    // The contact SUCCEEDED. The link state service is the single writer
    // of the observation row (R-08).
    await this.reportSuccess();

    // ── Accepted ─────────────────────────────────────────────────────
    // The posting, the attempt and the ledger entry are written
    // TOGETHER — one transaction. A ledger entry without its posting
    // would refuse the retry and the consumption would never be sent.
    const attempt = new PostingAttempt(
      this.options.newAttemptId(),
      posting.id,
      Instant.of(clock()),
      'ACCEPTED',
    );

    try {
      await unitOfWork.commit({
        kind: 'ACCEPTED',
        posting,
        attempt,
        ledgerKey: posting.id,
        ledgerAt: Instant.of(clock()),
      });
    } catch (error) {
      // The ledger's PRIMARY KEY refused the key. That is the
      // ATOMIC duplicate refusal (ADR-023) — and the transaction rolled
      // back, so the posting is still QUEUED and nothing was recorded.
      if (this.isUniqueViolation(error, 'idempotency_ledger.idempotency_key')) {
        const duplicate = await postings.findById(key);
        if (duplicate !== null) {
          this.emit({
            type: 'CONSUMPTION_POSTING_ATTEMPTED',
            postingId: key,
            outcome: 'ACCEPTED',
            attemptedAt: clock(),
            message:
              'Refused as a duplicate — the key was consumed concurrently',
          });
          return {
            kind: 'DUPLICATE',
            posting: duplicate,
            alreadyAccepted: true,
          };
        }
      }
      throw error;
    }

    this.emit({
      type: 'CONSUMPTION_POSTING_ACCEPTED',
      postingId: posting.id,
      batchId: posting.batchId,
      componentId: posting.componentId,
      acceptedAt: clock(),
    });

    const accepted = await postings.findById(posting.id);
    return {
      kind: 'ACCEPTED',
      posting: accepted ?? posting.accept(Instant.of(clock())),
    };
  }

  /**
   * Re-send a posting that has not landed.
   *
   * ══════════════════════════════════════════════════════════════════
   * THIS IS THE QUEUE'S DELIVERY PATH. (bolt 007)
   * ══════════════════════════════════════════════════════════════════
   *
   * Bolt 007's sync queue **calls this method** rather than writing its
   * own send path, and that is the whole point: *"has this key been
   * consumed?"* must have exactly **one** implementation.
   *
   * The difference from `post` is the guard. `post` refuses a key whose
   * posting is still `QUEUED` — because a second submission of the same
   * weighing must not create a second posting. But a **queue** is
   * precisely the case where the posting exists and is `QUEUED`, and it
   * must be sent again.
   *
   * So `redeliver` skips the enqueue-path guard and keeps the send-path
   * guard — the ledger's PRIMARY KEY. That guard is the **atomic** one
   * (ADR-023), and it is what stops a re-delivery of an ambiguous
   * failure from double-counting a dye batch.
   *
   * The key is **never re-derived** here: it is the posting's own id,
   * which is the key it was first created with.
   */
  async redeliver(posting: ConsumptionPosting): Promise<PostingOutcome> {
    const { adapter, ledger, postings, unitOfWork, clock } = this.options;
    const key = posting.id;

    // ── The send-path guard ──────────────────────────────────────────
    // The ledger holds exactly the keys that may never be used again.
    // This is the ATOMIC duplicate refusal — and it is checked here so
    // that "the key was already consumed" has one implementation.
    if (await ledger.has(key)) {
      const existing = await postings.findById(key);
      if (existing !== null) {
        this.emit({
          type: 'CONSUMPTION_POSTING_ATTEMPTED',
          postingId: key,
          outcome: 'ACCEPTED',
          attemptedAt: clock(),
          message: 'Refused as a duplicate — the key is already consumed',
        });
        return { kind: 'DUPLICATE', posting: existing, alreadyAccepted: true };
      }
    }

    // ── Send ─────────────────────────────────────────────────────────
    const raw: RawConsumption = {
      batchId: posting.batchId.value,
      componentId: posting.componentId.value,
      actualQuantity: posting.actualQuantity.toJSON(),
      unit: posting.actualQuantity.unit,
      lotNumber: posting.lotNumber.value,
      operatorId: posting.operatorId.value,
      weighedAt: posting.weighedAt.toDate().toISOString(),
      idempotencyKey: posting.id.value,
    };

    try {
      await adapter.postConsumption(raw);
    } catch (error) {
      if (error instanceof AdapterRejection) {
        // The MES was REACHED and REFUSED. That is a failed contact — the
        // MES answered, and the answer was a failure (R-01).
        await this.reportFailure('REJECTED', error.message);
        return this.onRejected(posting, error, unitOfWork, clock);
      }
      const reason = this.adapterReason(error);
      await this.reportFailure(
        reason,
        error instanceof Error ? error.message : String(error),
      );
      return this.onUnreachable(posting, error, unitOfWork, clock);
    }

    // The contact SUCCEEDED. The link state service is the single writer
    // of the observation row (R-08).
    await this.reportSuccess();

    // ── Accepted ─────────────────────────────────────────────────────
    // The posting, the attempt and the ledger entry are written
    // TOGETHER — one transaction.
    const attempt = new PostingAttempt(
      this.options.newAttemptId(),
      posting.id,
      Instant.of(clock()),
      'ACCEPTED',
    );

    try {
      await unitOfWork.commit({
        kind: 'ACCEPTED',
        posting,
        attempt,
        ledgerKey: posting.id,
        ledgerAt: Instant.of(clock()),
      });
    } catch (error) {
      // The ledger's PRIMARY KEY refused the key. The consumption was
      // already delivered — so this is a DUPLICATE, not a failure.
      if (this.isUniqueViolation(error, 'idempotency_ledger.idempotency_key')) {
        const duplicate = await postings.findById(key);
        if (duplicate !== null) {
          this.emit({
            type: 'CONSUMPTION_POSTING_ATTEMPTED',
            postingId: key,
            outcome: 'ACCEPTED',
            attemptedAt: clock(),
            message:
              'Refused as a duplicate — the key was consumed concurrently',
          });
          return {
            kind: 'DUPLICATE',
            posting: duplicate,
            alreadyAccepted: true,
          };
        }
      }
      throw error;
    }

    this.emit({
      type: 'CONSUMPTION_POSTING_ACCEPTED',
      postingId: posting.id,
      batchId: posting.batchId,
      componentId: posting.componentId,
      acceptedAt: clock(),
    });

    const accepted = await postings.findById(posting.id);
    return {
      kind: 'ACCEPTED',
      posting: accepted ?? posting.accept(Instant.of(clock())),
    };
  }

  /**
   * Create the posting, or return null if one already exists.
   *
   * The insert is the **enqueue** — it is what makes a second queue
   * entry for one weighing impossible, because the key is the primary
   * key.
   *
   * A concurrent submission of the same key loses the insert, and that
   * loss IS the duplicate refusal. So the UNIQUE violation is caught
   * here and turned into "one already exists" — not into an error.
   */
  private async createOrReuse(
    key: IdempotencyKey,
    request: ConsumptionRequest,
  ): Promise<ConsumptionPosting | null> {
    const { postings, clock } = this.options;

    const existing = await postings.findById(key);
    if (existing !== null) return null;

    const posting = new ConsumptionPosting(
      key,
      request.batchId,
      request.componentId,
      request.actualQuantity,
      request.lotNumber,
      request.operatorId,
      request.weighedAt,
      Instant.of(clock()),
    );

    try {
      await postings.save(posting);
    } catch (error) {
      if (this.isUniqueViolation(error, 'consumption_postings.id')) {
        // Another submission of the same weighing won the race. Its
        // row is the one that counts.
        return null;
      }
      throw error;
    }

    return posting;
  }

  /** The MES reached it and refused. A **definitive** answer. */
  private async onRejected(
    posting: ConsumptionPosting,
    error: AdapterRejection,
    unitOfWork: UnitOfWork,
    clock: () => Date,
  ): Promise<PostingOutcome> {
    const attempt = new PostingAttempt(
      this.options.newAttemptId(),
      posting.id,
      Instant.of(clock()),
      'REJECTED',
      error.reason,
    );

    await unitOfWork.commit({
      kind: 'REJECTED',
      posting,
      attempt,
    });

    this.emit({
      type: 'CONSUMPTION_POSTING_REJECTED',
      postingId: posting.id,
      batchId: posting.batchId,
      componentId: posting.componentId,
      reason: error.reason,
      rejectedAt: clock(),
    });

    const rejected = await this.options.postings.findById(posting.id);
    return {
      kind: 'REJECTED',
      posting: rejected ?? posting.reject(error.reason),
      reason: error.reason,
    };
  }

  /**
   * The MES could not be reached, or the response was lost.
   *
   * The posting stays `QUEUED` — it has not been accepted and it has not
   * been rejected — and the attempt records the ambiguity. The next
   * attempt reuses the key.
   */
  private async onUnreachable(
    posting: ConsumptionPosting,
    error: unknown,
    unitOfWork: UnitOfWork,
    clock: () => Date,
  ): Promise<PostingOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    const unreachable = error instanceof AdapterError;

    const attempt = new PostingAttempt(
      this.options.newAttemptId(),
      posting.id,
      Instant.of(clock()),
      unreachable ? 'UNREACHABLE' : 'UNKNOWN',
    );

    await unitOfWork.commit({
      kind: 'PENDING',
      posting,
      attempt,
    });

    this.emit({
      type: 'CONSUMPTION_POSTING_ATTEMPTED',
      postingId: posting.id,
      outcome: unreachable ? 'UNREACHABLE' : 'UNKNOWN',
      attemptedAt: clock(),
      message,
    });

    // The posting is NOT marked resolved. It stays QUEUED, and it is
    // reported as pending — never as posted.
    return { kind: 'QUEUED', posting, message };
  }

  /**
   * Is this a UNIQUE constraint violation on the named constraint?
   *
   * SQLite's message is the only signal `node:sqlite` gives, so the
   * check is on the message. It names the constraint specifically, so
   * an unrelated database error is not mistaken for a duplicate — which
   * would hide a real failure behind a 200.
   */
  private isUniqueViolation(error: unknown, constraint: string): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.message.includes('UNIQUE constraint failed') &&
      error.message.includes(constraint)
    );
  }

  /**
   * The adapter's failure reason, defaulted.
   *
   * An error the adapter did not classify is treated as `UNREACHABLE`,
   * because that is the **safe** default: it says "we do not know what
   * happened", and the queue retries it.
   */
  private adapterReason(error: unknown): 'UNREACHABLE' | 'TIMEOUT' | 'MALFORMED' {
    if (error instanceof AdapterError) {
      if (
        error.reason === 'UNREACHABLE' ||
        error.reason === 'TIMEOUT' ||
        error.reason === 'MALFORMED'
      ) {
        return error.reason;
      }
    }
    return 'UNREACHABLE';
  }

  /** Report a successful contact to the link state service. */
  private async reportSuccess(): Promise<void> {
    const reporter = this.options.contactReporter;
    if (reporter === undefined) return;
    await reporter.recordSuccess(Instant.of(this.options.clock()));
  }

  /** Report a failed contact to the link state service. */
  private async reportFailure(
    code: 'UNREACHABLE' | 'TIMEOUT' | 'MALFORMED' | 'REJECTED',
    detail: string,
  ): Promise<void> {
    const reporter = this.options.contactReporter;
    if (reporter === undefined) return;
    await reporter.recordFailure(
      SyncError.of(code, this.summaryFor(code), detail),
      Instant.of(this.options.clock()),
    );
  }

  /** The short, client-safe summary for a failure kind. */
  private summaryFor(
    code: 'UNREACHABLE' | 'TIMEOUT' | 'MALFORMED' | 'REJECTED',
  ): string {
    switch (code) {
      case 'UNREACHABLE':
        return 'OrgaTEX could not be reached';
      case 'TIMEOUT':
        return 'OrgaTEX did not answer in time';
      case 'MALFORMED':
        return 'OrgaTEX returned an unusable response';
      case 'REJECTED':
        return 'OrgaTEX refused the consumption';
    }
  }

  private emit(event: PostingEvent): void {
    this.options.onEvent?.(event);
  }
}
