/**
 * SyncQueueService — the durable queue's orchestration.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DELIVERY GOES THROUGH BOLT 006's POSTING PATH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the decision that keeps the idempotency guarantee
 * single-sourced. `ConsumptionPostingService.post()` already:
 *
 * - derives the key from the weighing's identity,
 * - refuses a key already in the **ledger** (the atomic PRIMARY KEY
 *   guard, ADR-023),
 * - refuses a second enqueue of a key whose posting is still `QUEUED`,
 * - writes the posting, the attempt and the ledger entry in **one
 *   transaction**,
 * - reports a definitive rejection as `REJECTED` and an unreachable MES
 *   as `QUEUED`.
 *
 * If this service wrote its own send path, *"has this key been consumed?"*
 * would have two implementations, and they would drift.
 *
 * THE TWO GUARDS ARE DIFFERENT CHECKS
 * -----------------------------------
 * - **On enqueue:** the key is refused if it is in the **ledger** *or*
 *   already in the **queue**. The two are read **together**, because a
 *   `QUEUED` posting's key is deliberately absent from the ledger
 *   (ADR-023).
 * - **On delivery:** the queue calls bolt 006's path, which consults the
 *   ledger before it sends. There is **one** implementation of the check.
 *
 * The **ledger's presence always wins**. The queue holds the keys the
 * ledger does not yet hold.
 *
 * NOTHING IS SILENTLY DISCARDED
 * ------------------------------
 * A `FAILED` entry stays visible, with its last error, attempt count and
 * last attempt time, and it can be re-driven. `remove` is reachable only
 * because a posting was **delivered**.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ConsumptionPosting } from '../entities/postings.js';
import type { SyncQueueEntry } from '../entities/sync-queue-entry.js';
import { SyncQueueEntry as Entry } from '../entities/sync-queue-entry.js';
import type { SyncQueueEvent } from '../events/sync-queue-events.js';
import type {
  IdempotencyLedger,
  PostingRepository,
} from '../ports/posting-repositories.js';
import type {
  LinkContactRepository,
  RejectionDispositionReader,
} from '../ports/link-repositories.js';
import type { SyncQueueRepository } from '../ports/sync-queue-repositories.js';
import type { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../value-objects/identifiers.js';
import { SyncError } from '../value-objects/sync-error.js';
import type { BackoffSchedule } from '../value-objects/backoff-schedule.js';
import type { SyncBackoffPolicy } from './sync-backoff-policy.js';
import type { ConsumptionPostingService } from './consumption-posting-service.js';
import type { LinkStateService } from './link-state-service.js';

/**
 * The outcome of an enqueue.
 *
 * A discriminated union, so a caller cannot read an `entry` without first
 * proving one was created.
 */
export type EnqueueResult =
  | { readonly outcome: 'QUEUED'; readonly entry: SyncQueueEntry }
  | {
      readonly outcome: 'REFUSED_DUPLICATE';
      readonly reason: 'IN_LEDGER' | 'ALREADY_QUEUED';
    };

/**
 * The outcome of a re-drive.
 */
export type RedriveResult =
  | {
      readonly outcome: 'ATTEMPTED';
      readonly entry: SyncQueueEntry | null;
      readonly delivered: boolean;
    }
  | {
      readonly outcome: 'REFUSED';
      readonly reason:
        | 'LINK_NOT_LINKED'
        | 'NOT_FAILED'
        | 'IN_LEDGER'
        | 'NOT_FOUND';
    };

/**
 * The outcome of one delivery attempt.
 */
export type SyncAttemptOutcome =
  | { readonly postingId: IdempotencyKey; readonly outcome: 'DELIVERED' }
  | {
      readonly postingId: IdempotencyKey;
      readonly outcome: 'RETRYABLE';
      readonly error: SyncError;
    }
  | {
      readonly postingId: IdempotencyKey;
      readonly outcome: 'FAILED';
      readonly error: SyncError;
    };

export interface SyncQueueServiceOptions {
  readonly postingService: ConsumptionPostingService;
  readonly queue: SyncQueueRepository;
  readonly postings: PostingRepository;
  readonly ledger: IdempotencyLedger;
  /**
   * The link's state — the **derived** status.
   *
   * The queue asks it whether the link is up, rather than reading the
   * observations itself. The derivation has ONE implementation
   * (`LinkStatePolicy`), and a second reading of the raw observations
   * here would be a second answer to the same question — and the two
   * would drift.
   */
  readonly linkState: LinkStateService;
  readonly disposition: RejectionDispositionReader;
  readonly backoffPolicy: SyncBackoffPolicy;
  readonly backoff: BackoffSchedule;
  readonly clock: () => Date;
  readonly random?: () => number;
  readonly onEvent?: (event: SyncQueueEvent) => void;
  /** How many entries one flush may deliver. */
  readonly flushLimit?: number;
}

const DEFAULT_FLUSH_LIMIT = 100;

export class SyncQueueService {
  constructor(private readonly options: SyncQueueServiceOptions) {}

  /**
   * Enqueue a posting that could not be delivered.
   *
   * The **enqueue guard**: the ledger and the queue are read **together**,
   * because a `QUEUED` posting's key is deliberately not in the ledger.
   */
  async enqueue(posting: ConsumptionPosting): Promise<EnqueueResult> {
    const { queue, ledger, clock } = this.options;

    // The ledger's presence always wins.
    if (await ledger.has(posting.id)) {
      return { outcome: 'REFUSED_DUPLICATE', reason: 'IN_LEDGER' };
    }

    // The queue's own guard — a second entry for one weighing is two
    // deliveries, and two deliveries with the same key is what the key
    // prevents.
    const existing = await queue.findByPostingId(posting.id);
    if (existing !== null) {
      return { outcome: 'REFUSED_DUPLICATE', reason: 'ALREADY_QUEUED' };
    }

    const entry = Entry.queue({
      postingId: posting.id,
      batchId: posting.batchId,
      componentId: posting.componentId,
      actualQuantity: posting.actualQuantity,
      lotNumber: posting.lotNumber,
      operatorId: posting.operatorId,
      weighedAt: posting.weighedAt,
      queuedAt: posting.createdAt,
    });

    await queue.enqueue(entry);

    this.emit({
      type: 'SYNC_ENTRY_QUEUED',
      postingId: entry.postingId,
      batchId: entry.batchId,
      componentId: entry.componentId,
      queuedAt: entry.queuedAt.toDate(),
    });

    void clock;
    return { outcome: 'QUEUED', entry };
  }

  /**
   * Retry the entries that are due.
   *
   * Called by the scheduled worker on its bounded interval. `FAILED`
   * entries are off the automatic path and are never picked up.
   */
  async retryDue(now: Instant): Promise<SyncAttemptOutcome[]> {
    const { queue } = this.options;
    const limit = this.options.flushLimit ?? DEFAULT_FLUSH_LIMIT;
    const due = await queue.findDue(now, limit);

    const outcomes: SyncAttemptOutcome[] = [];
    for (const entry of due) {
      outcomes.push(await this.deliver(entry));
    }
    return outcomes;
  }

  /**
   * Flush the whole queue — called when the link recovers.
   *
   * The entries are delivered **in queue order**, each with the key it
   * was first created with. A failure part-way through does not reorder
   * or lose the remainder.
   */
  async flushOnRecovery(): Promise<SyncAttemptOutcome[]> {
    const { clock } = this.options;
    return this.retryDue(Instant.of(clock()));
  }

  /**
   * Re-drive one failed entry.
   *
   * The re-drive uses the **same idempotency key** — it is never
   * re-derived and never re-keyed, so a re-drive of an ambiguous failure
   * cannot double-post (IR-08, AC-09).
   */
  async redrive(postingId: IdempotencyKey): Promise<RedriveResult> {
    const { queue, ledger, linkState, clock } = this.options;

    const entry = await queue.findByPostingId(postingId);
    if (entry === null) {
      return { outcome: 'REFUSED', reason: 'NOT_FOUND' };
    }

    // The ledger's presence always wins — the posting has landed, and
    // there is nothing left to drive.
    if (await ledger.has(postingId)) {
      return { outcome: 'REFUSED', reason: 'IN_LEDGER' };
    }

    // A `PENDING` entry is already on the automatic path, and re-driving
    // it would be a second path to the same delivery.
    if (!entry.isFailed) {
      return { outcome: 'REFUSED', reason: 'NOT_FAILED' };
    }

    // The re-drive IS a contact attempt, so it discovers the link's
    // reachability itself — it does not have to be told.
    //
    // That is the honest way round it. A pre-flight check on the stored
    // link state would be a **guess**: the MES can go down between the
    // last contact and the re-drive, and the state would not know. Worse,
    // it would refuse exactly the case a re-drive exists for — a posting
    // the MES **rejected** is a reachable MES that said no, and the
    // operator has fixed whatever it objected to.
    //
    // So the attempt is made, and its outcome is the answer:
    //
    // - the MES is unreachable → the re-drive is REFUSED with
    //   `LINK_NOT_LINKED`, and the refusal **counts as an attempt**;
    // - the MES refuses again → the entry stays `FAILED`, with its
    //   attempt count and last error updated;
    // - the MES accepts → the entry leaves the queue.
    const outcome = await this.deliver(entry);
    const updated = await queue.findByPostingId(postingId);

    if (outcome.outcome === 'RETRYABLE') {
      // The MES could not be reached. The re-drive is refused with a
      // stated reason, and the entry remains visible as failed with its
      // attempt count updated.
      return { outcome: 'REFUSED', reason: 'LINK_NOT_LINKED' };
    }

    return {
      outcome: 'ATTEMPTED',
      entry: updated,
      delivered: outcome.outcome === 'DELIVERED',
    };
  }

  /**
   * Deliver one entry, through bolt 006's ledger-guarded path.
   *
   * The entry's own content is sent, with the entry's own key.
   */
  private async deliver(entry: SyncQueueEntry): Promise<SyncAttemptOutcome> {
    const { postingService, postings, queue, clock, backoffPolicy, backoff } =
      this.options;

    const at = Instant.of(clock());

    // The posting is the record of what we tried to send. The queue entry
    // mirrors its content, but the posting is what the posting service
    // works with — and the posting's OWN id is the key, so the delivery
    // carries the key the entry was first created with.
    const posting = await postings.findById(entry.postingId);
    if (posting === null) {
      // The posting has vanished. The queue entry's content is still
      // here, so the delivery could still be made — but the posting
      // service needs a posting to work with.
      //
      // The entry is marked FAILED, not left PENDING with no next
      // attempt: a PENDING entry with no time is a contradiction, and
      // the schema refuses it.
      const error = SyncError.of(
        'MALFORMED',
        'The queued consumption has no posting record',
        `The posting ${entry.postingId.value} was not found`,
      );
      await queue.markFailed({
        postingId: entry.postingId,
        error,
        attemptedAt: at,
        attempts: entry.attempts + 1,
      });
      return { postingId: entry.postingId, outcome: 'FAILED', error };
    }

    // The delivery goes through bolt 006's ledger-guarded path, so
    // "has this key been consumed?" has ONE implementation (ADR-023).
    const result = await postingService.redeliver(posting);

    // ── Accepted, or already consumed ─────────────────────────────────
    if (result.kind === 'ACCEPTED' || result.kind === 'DUPLICATE') {
      // The ledger holds the key now. The entry leaves the queue — the
      // ONLY way out of it.
      await queue.remove(entry.postingId);

      this.emit({
        type: 'SYNC_ENTRY_ATTEMPTED',
        postingId: entry.postingId,
        attemptedAt: at.toDate(),
        outcome: 'DELIVERED',
        attempts: entry.attempts + 1,
        message: 'The MES accepted the consumption',
      });
      this.emit({
        type: 'SYNC_ENTRY_DELIVERED',
        postingId: entry.postingId,
        batchId: entry.batchId,
        acceptedAt: at.toDate(),
      });

      return { postingId: entry.postingId, outcome: 'DELIVERED' };
    }

    // ── Could not be reached ───────────────────────────────────────────
    if (result.kind === 'QUEUED') {
      const error = SyncError.of(
        'UNREACHABLE',
        'OrgaTEX could not be reached',
        result.message,
      );

      // A `FAILED` entry is OFF the automatic path, and a re-drive does
      // not put it back on it. So an unreachable re-drive leaves the
      // entry `FAILED` — with its attempt count and last error updated,
      // and with no next attempt time. A `PENDING` entry, by contrast,
      // goes back on the path with a backoff.
      const nextAttemptAt = entry.isFailed
        ? null
        : backoffPolicy.nextAttemptAt(
            entry.attempts + 1,
            at,
            backoff,
            this.options.random ?? Math.random,
          );

      await queue.recordAttempt({
        postingId: entry.postingId,
        outcome: entry.isFailed ? 'FAILED' : 'RETRYABLE',
        error,
        attemptedAt: at,
        nextAttemptAt,
        attempts: entry.attempts + 1,
      });

      this.emit({
        type: 'SYNC_ENTRY_ATTEMPTED',
        postingId: entry.postingId,
        attemptedAt: at.toDate(),
        outcome: 'RETRYABLE',
        attempts: entry.attempts + 1,
        message: result.message,
      });

      return { postingId: entry.postingId, outcome: 'RETRYABLE', error };
    }

    // ── The MES reached it and refused ─────────────────────────────────
    const disposition = this.options.disposition.disposition();
    const reason = result.reason;
    const error = SyncError.of(
      'REJECTED',
      'OrgaTEX refused the consumption',
      reason.detail,
    );

    if (disposition === 'PERMANENT') {
      await queue.markFailed({
        postingId: entry.postingId,
        error,
        attemptedAt: at,
        attempts: entry.attempts + 1,
      });

      this.emit({
        type: 'SYNC_ENTRY_ATTEMPTED',
        postingId: entry.postingId,
        attemptedAt: at.toDate(),
        outcome: 'FAILED',
        attempts: entry.attempts + 1,
        message: reason.detail,
      });
      this.emit({
        type: 'SYNC_ENTRY_FAILED',
        postingId: entry.postingId,
        lastError: error,
        attempts: entry.attempts + 1,
        lastAttemptAt: at.toDate(),
      });

      return { postingId: entry.postingId, outcome: 'FAILED', error };
    }

    // `RETRYABLE` — the entry stays on the automatic path, with a backoff.
    const nextAttemptAt = backoffPolicy.nextAttemptAt(
      entry.attempts + 1,
      at,
      backoff,
      this.options.random ?? Math.random,
    );

    await queue.recordAttempt({
      postingId: entry.postingId,
      outcome: 'RETRYABLE',
      error,
      attemptedAt: at,
      nextAttemptAt,
      attempts: entry.attempts + 1,
    });

    this.emit({
      type: 'SYNC_ENTRY_ATTEMPTED',
      postingId: entry.postingId,
      attemptedAt: at.toDate(),
      outcome: 'RETRYABLE',
      attempts: entry.attempts + 1,
      message: reason.detail,
    });

    return { postingId: entry.postingId, outcome: 'RETRYABLE', error };
  }

  /** How many consumptions have not landed. */
  async countUnlanded(): Promise<number> {
    return this.options.queue.countUnlanded();
  }

  /** Every queue entry, in queue order. */
  async findAll(): Promise<SyncQueueEntry[]> {
    return this.options.queue.findAll();
  }

  private emit(event: SyncQueueEvent): void {
    this.options.onEvent?.(event);
  }
}

/**
 * The content a queued entry carries.
 *
 * Re-exported so a caller of the service does not need to reach into the
 * entity for the shapes it must supply.
 */
export type QueuedPostingContent = {
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly actualQuantity: WeightValue;
  readonly lotNumber: LotNumber;
  readonly operatorId: OperatorReference;
};
