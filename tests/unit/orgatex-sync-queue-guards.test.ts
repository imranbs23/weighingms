/**
 * The sync queue's guards and refusals (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PLACES WHERE THE QUEUE SAYS "NO".
 * ══════════════════════════════════════════════════════════════════════
 *
 * The queue's happy path is in `orgatex-sync-queue.test.ts`. This file
 * covers the **refusals**, and each one is a place where the alternative
 * is a wrong number:
 *
 * - a key that is already in the **ledger** is never queued;
 * - a key that is already in the **ledger** is never re-driven;
 * - a queue entry whose posting has **vanished** is marked `FAILED` with a
 *   `MALFORMED` error — not delivered, and not silently dropped;
 * - the flush on recovery delivers in **queue order**.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { BackoffSchedule } from '../../src/005-orgatex-integration/domain/value-objects/backoff-schedule.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import {
  ConsumptionPosting,
} from '../../src/005-orgatex-integration/domain/entities/postings.js';
import {
  SyncQueueEntry,
} from '../../src/005-orgatex-integration/domain/entities/sync-queue-entry.js';
import { PureSyncBackoffPolicy } from '../../src/005-orgatex-integration/domain/services/sync-backoff-policy.js';
import { LinkStateService } from '../../src/005-orgatex-integration/domain/services/link-state-service.js';
import { PureLinkStatePolicy } from '../../src/005-orgatex-integration/domain/services/link-state-policy.js';
import { FreshnessWindow } from '../../src/005-orgatex-integration/domain/value-objects/freshness-window.js';
import { SqliteLinkTransitionRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-transition-repository.js';
import { ManualLinkScheduler } from '../support/orgatex-harness.js';
import { SyncQueueService } from '../../src/005-orgatex-integration/domain/services/sync-queue-service.js';
import type {
  ConsumptionPostingService,
  PostingOutcome,
} from '../../src/005-orgatex-integration/domain/services/consumption-posting-service.js';
import { openOrgatexDatabase } from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import { SqliteSyncQueueRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-sync-queue-repository.js';
import { SqliteLinkContactRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-contact-repository.js';
import { SqliteIdempotencyLedger } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-posting-repository.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

function keyFor(label: string): string {
  let hash = 0;
  for (const char of label) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `IDK-${hash.toString(16).padStart(16, '0').slice(0, 16)}`;
}

function posting(label: string): ConsumptionPosting {
  return new ConsumptionPosting(
    IdempotencyKey.of(keyFor(label)),
    BatchId.create('B-24187'),
    ComponentId.create('C-01'),
    WeightValue.of('94.01', 'g'),
    LotNumber.create('L-77120'),
    OperatorReference.create('OP-001'),
    T0,
    T0,
  );
}

function entryFor(label: string): SyncQueueEntry {
  const p = posting(label);
  return SyncQueueEntry.queue({
    postingId: p.id,
    batchId: p.batchId,
    componentId: p.componentId,
    actualQuantity: p.actualQuantity,
    lotNumber: p.lotNumber,
    operatorId: p.operatorId,
    weighedAt: p.weighedAt,
    queuedAt: p.createdAt,
  });
}

class StubPostingService {
  readonly sent: string[] = [];

  outcome: (posting: ConsumptionPosting) => PostingOutcome;

  constructor(
    outcome: (posting: ConsumptionPosting) => PostingOutcome = () => ({
      kind: 'QUEUED',
      posting: posting('DEFAULT'),
      message: 'unreachable',
    }),
  ) {
    this.outcome = outcome;
  }

  async post(): Promise<PostingOutcome> {
    throw new Error('The queue must not use the enqueue path');
  }

  async redeliver(p: ConsumptionPosting): Promise<PostingOutcome> {
    this.sent.push(p.id.value);
    return this.outcome(p);
  }
}

function build(options?: {
  readonly outcome?: (posting: ConsumptionPosting) => PostingOutcome;
  readonly disposition?: 'RETRYABLE' | 'PERMANENT';
  /**
   * Whether a randomness source is injected.
   *
   * `false` leaves it out entirely, so the service falls back to
   * `Math.random` — the production path, which the other tests never
   * take because they inject `() => 0` for determinism.
   */
  readonly injectRandom?: boolean;
}): {
  readonly queue: SqliteSyncQueueRepository;
  readonly postings: SqlitePostingRepository;
  readonly ledger: SqliteIdempotencyLedger;
  readonly service: SyncQueueService;
  readonly postingService: StubPostingService;
} {
  const db = openOrgatexDatabase(':memory:');
  const queue = new SqliteSyncQueueRepository(db);
  const contacts = new SqliteLinkContactRepository(db);
  const transitions = new SqliteLinkTransitionRepository(db);
  const postings = new SqlitePostingRepository(db);
  const ledger = new SqliteIdempotencyLedger(db);

  const linkState = new LinkStateService({
    policy: new PureLinkStatePolicy(),
    contacts,
    transitions,
    scheduler: new ManualLinkScheduler(),
    freshnessWindow: FreshnessWindow.of(5 * 60 * 1000),
    clock: () => T0.toDate(),
  });

  const postingService = new StubPostingService(options?.outcome);

  const service = new SyncQueueService({
    postingService: postingService as unknown as ConsumptionPostingService,
    queue,
    postings,
    ledger,
    linkState,
    disposition: { disposition: () => options?.disposition ?? 'RETRYABLE' },
    backoffPolicy: new PureSyncBackoffPolicy(),
    backoff: BackoffSchedule.of(1000, 60_000, 2, 0),
    clock: () => T0.toDate(),
    ...(options?.injectRandom === false ? {} : { random: () => 0 }),
  });

  return { queue, postings, ledger, service, postingService };
}

describe('SyncQueueService — the ledger always wins', () => {
  it('an enqueue is refused when the key is already in the LEDGER', async () => {
    const { service, ledger, postings } = build();

    // The key has been consumed — so there is nothing to queue. The
    // ledger's presence always wins (ADR-023).
    await postings.save(posting('CONSUMED'));
    await ledger.record(
      IdempotencyKey.of(keyFor('CONSUMED')),
      IdempotencyKey.of(keyFor('CONSUMED')),
      T0,
    );

    const result = await service.enqueue(posting('CONSUMED'));

    expect(result.outcome).toBe('REFUSED_DUPLICATE');
    if (result.outcome !== 'REFUSED_DUPLICATE') return;
    expect(result.reason).toBe('IN_LEDGER');
  });

  it('a re-drive is refused when the key is already in the LEDGER', async () => {
    const { service, queue, ledger, postings } = build({
      outcome: (p) => ({
        kind: 'REJECTED',
        posting: p,
        reason: {
          code: 'UNMAPPED',
          detail: 'not acceptable',
        },
      } as unknown as PostingOutcome),
    });

    const entry = entryFor('CONSUMED');
    await queue.enqueue(entry);
    await postings.save(posting('CONSUMED'));
    await ledger.record(
      IdempotencyKey.of(keyFor('CONSUMED')),
      IdempotencyKey.of(keyFor('CONSUMED')),
      T0,
    );

    const result = await service.redrive(entry.postingId);

    // The posting has landed — there is nothing left to drive, and a
    // second delivery would double-count a dye batch.
    expect(result.outcome).toBe('REFUSED');
    if (result.outcome !== 'REFUSED') return;
    expect(result.reason).toBe('IN_LEDGER');
  });
});

describe('SyncQueueService — the flush on recovery', () => {
  it('the flush delivers EVERYTHING queued, in queue order', async () => {
    const { service, queue, postings, postingService } = build({
      outcome: (p) => ({ kind: 'ACCEPTED', posting: p }),
    });

    for (const label of ['A', 'B', 'C']) {
      await postings.save(posting(label));
      await queue.enqueue(entryFor(label));
    }

    const outcomes = await service.flushOnRecovery();

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.outcome)).toEqual([
      'DELIVERED',
      'DELIVERED',
      'DELIVERED',
    ]);
    // The order is the queue's order — not the send order.
    expect(postingService.sent).toEqual([
      keyFor('A'),
      keyFor('B'),
      keyFor('C'),
    ]);
    // And the queue is empty afterwards.
    expect(await queue.countUnlanded()).toBe(0);
  });

  it('a flush of an EMPTY queue delivers nothing', async () => {
    const { service, postingService } = build();

    const outcomes = await service.flushOnRecovery();

    expect(outcomes).toEqual([]);
    expect(postingService.sent).toEqual([]);
  });
});

describe('SyncQueueService — a queue entry whose posting has vanished', () => {
  it('the entry is marked FAILED with a MALFORMED error — not delivered, not dropped', async () => {
    const { service, queue } = build();

    // The queue entry exists, but its posting row does NOT — a corrupt
    // state that the service must report rather than paper over.
    await queue.enqueue(entryFor('ORPHAN'));

    const outcomes = await service.retryDue(T0);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.outcome).toBe('FAILED');

    // The entry is STILL THERE — visible, failed, with its error.
    const entry = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('ORPHAN')),
    );
    expect(entry).not.toBeNull();
    expect(entry?.state).toBe('FAILED');
    expect(entry?.lastError?.code).toBe('MALFORMED');
    expect(entry?.attempts).toBe(1);
    // Off the automatic path — the worker will not retry it.
    expect(entry?.nextAttemptAt).toBeNull();
  });
});

describe('SyncQueueService — the rejected path under RETRYABLE', () => {
  it('the entry stays PENDING with a BACKOFF, and its error is kept', async () => {
    const { service, queue, postings } = build({
      disposition: 'RETRYABLE',
      outcome: (p) =>
        ({
          kind: 'REJECTED',
          posting: p,
          reason: { code: 'UNMAPPED', detail: 'the MES refused it' },
        }) as unknown as PostingOutcome,
    });

    const p = posting('RETRYABLE');
    await postings.save(p);
    await queue.enqueue(entryFor('RETRYABLE'));

    const outcomes = await service.retryDue(T0);

    expect(outcomes[0]?.outcome).toBe('RETRYABLE');

    const entry = await queue.findByPostingId(p.id);
    expect(entry?.state).toBe('PENDING');
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError?.code).toBe('REJECTED');
    // The backoff put it back on the automatic path.
    expect(entry?.nextAttemptAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
  });

  it('the default jitter source is used when none is injected', async () => {
    const { service, queue, postings } = build({
      disposition: 'RETRYABLE',
      injectRandom: false,
      outcome: (p) =>
        ({
          kind: 'REJECTED',
          posting: p,
          reason: { code: 'UNMAPPED', detail: 'the MES refused it' },
        }) as unknown as PostingOutcome,
    });

    const p = posting('DEFAULT_JITTER');
    await postings.save(p);
    await queue.enqueue(entryFor('DEFAULT_JITTER'));

    await service.retryDue(T0);

    const entry = await queue.findByPostingId(p.id);
    expect(entry?.state).toBe('PENDING');
    expect(entry?.attempts).toBe(1);
    const next = entry?.nextAttemptAt?.epochMillis ?? 0;
    expect(next).toBeGreaterThan(T0.epochMillis);
    expect(next).toBeLessThanOrEqual(T0.plus(60_000).epochMillis);
  });
});

describe('SqliteSyncQueueRepository — the refusals', () => {
  it('marking a MISSING entry failed is refused loudly', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    // An attempt cannot be recorded against nothing — and a silent
    // no-op would be a lost consumption.
    await expect(
      queue.markFailed({
        postingId: IdempotencyKey.of(keyFor('ABSENT')),
        error: SyncError.of('REJECTED', 'OrgaTEX refused the consumption', 'd'),
        attemptedAt: T0,
        attempts: 1,
      }),
    ).rejects.toThrow(/cannot be marked failed/);
  });

  it('removing a MISSING entry is refused loudly', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await expect(
      queue.remove(IdempotencyKey.of(keyFor('ABSENT'))),
    ).rejects.toThrow(/only a delivered entry may be removed/);
  });

  it('rescheduling a MISSING entry is refused loudly', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await expect(
      queue.reschedule(IdempotencyKey.of(keyFor('ABSENT')), T0.plus(1000)),
    ).rejects.toThrow(/a failed entry is off the automatic path/);
  });

  it('recording an attempt against a MISSING entry is refused loudly', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await expect(
      queue.recordAttempt({
        postingId: IdempotencyKey.of(keyFor('ABSENT')),
        outcome: 'RETRYABLE',
        error: null,
        attemptedAt: T0,
        nextAttemptAt: T0.plus(1000),
        attempts: 1,
      }),
    ).rejects.toThrow(/an attempt cannot be recorded against nothing/);
  });
});
