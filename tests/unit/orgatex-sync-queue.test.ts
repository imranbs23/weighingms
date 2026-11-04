/**
 * The sync queue's behaviour (bolt 007, R-09 … R-14).
 *
 * The queue is tested against the **real** SQLite repository, so a test
 * that passes here is a test of the production path — not of a stub's
 * idea of it.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { BackoffSchedule } from '../../src/005-orgatex-integration/domain/value-objects/backoff-schedule.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import { RejectionReason } from '../../src/005-orgatex-integration/domain/value-objects/rejection-reason.js';
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

/**
 * A valid idempotency key for a test.
 *
 * The key must be `IDK-` followed by 16 lowercase hex characters, so a
 * readable label is hashed into the shape the value object demands.
 */
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

/**
 * A posting service that answers with a scripted outcome.
 *
 * It records the keys it was asked to send, so a test can prove the
 * delivery reuses the ORIGINAL key (IR-08).
 */
class StubPostingService {
  readonly sent: string[] = [];

  /**
   * The MES's answer.
   *
   * It is a **field**, not a constructor argument, so a test can change
   * what the MES answers between the retry and the re-drive — which is
   * exactly what happens when the link comes back and then goes down
   * again.
   */
  outcome: (posting: ConsumptionPosting) => PostingOutcome;

  constructor(
    outcome: (posting: ConsumptionPosting) => PostingOutcome,
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

interface Harness {
  readonly queue: SqliteSyncQueueRepository;
  readonly contacts: SqliteLinkContactRepository;
  readonly postings: SqlitePostingRepository;
  readonly service: SyncQueueService;
  readonly postingService: StubPostingService;
}

function build(options?: {
  readonly outcome?: (posting: ConsumptionPosting) => PostingOutcome;
  readonly disposition?: 'RETRYABLE' | 'PERMANENT';
}): Harness {
  const db = openOrgatexDatabase(':memory:');
  const queue = new SqliteSyncQueueRepository(db);
  const contacts = new SqliteLinkContactRepository(db);
  const transitions = new SqliteLinkTransitionRepository(db);
  const postings = new SqlitePostingRepository(db);
  const ledger = new SqliteIdempotencyLedger(db);

  // The REAL link state service, so the queue asks the derived status
  // rather than a test's idea of it.
  const linkState = new LinkStateService({
    policy: new PureLinkStatePolicy(),
    contacts,
    transitions,
    scheduler: new ManualLinkScheduler(),
    freshnessWindow: FreshnessWindow.of(5 * 60 * 1000),
    clock: () => T0.toDate(),
  });

  const postingService = new StubPostingService(
    options?.outcome ??
      ((p) => ({
        kind: 'QUEUED',
        posting: p,
        message: 'OrgaTEX could not be reached',
      })),
  );

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
    // The jitter is injected, so the tests are deterministic.
    random: () => 0,
  });

  return { queue, contacts, postings, service, postingService };
}

/**
 * Queue an entry the way the real flow does.
 *
 * The posting row is written **first** — the real flow posts through bolt
 * 006, which creates the posting, and only then does the queue entry
 * exist. The delivery goes back through the posting row, so a queue entry
 * without one would be a corrupt state — and the service says so rather
 * than guessing.
 */
async function queueEntry(
  harness: Harness,
  label: string,
): Promise<void> {
  await harness.postings.save(posting(label));
  await harness.queue.enqueue(entryFor(label));
}

describe('SyncQueueService — enqueue', () => {
  it('enqueues an undeliverable posting — R-09', async () => {
    const { service } = build();

    const result = await service.enqueue(posting('ONE'));

    expect(result.outcome).toBe('QUEUED');
    if (result.outcome !== 'QUEUED') return;
    expect(result.entry.postingId.value).toBe(keyFor('ONE'));
    expect(result.entry.attempts).toBe(0);
    expect(result.entry.state).toBe('PENDING');
    expect(result.entry.nextAttemptAt).not.toBeNull();
  });

  it('refuses a second enqueue for the same key — R-10', async () => {
    const { service } = build();
    const entry = posting('ONE');

    await service.enqueue(entry);
    const second = await service.enqueue(entry);

    expect(second.outcome).toBe('REFUSED_DUPLICATE');
    if (second.outcome !== 'REFUSED_DUPLICATE') return;
    expect(second.reason).toBe('ALREADY_QUEUED');
  });

  it('the queue is DURABLE across a restart, with the SAME key — R-10', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('DURABLE'));

    // A NEW repository over the same database — the equivalent of a
    // restart.
    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('DURABLE')),
    );

    expect(found).not.toBeNull();
    expect(found?.postingId.value).toBe(keyFor('DURABLE'));
    expect(found?.state).toBe('PENDING');
    expect(found?.attempts).toBe(0);
  });
});

describe('SyncQueueService — delivery', () => {
  it('the delivery reuses the ORIGINAL key — R-11, IR-08', async () => {
    const harness = build();
    const { service, postingService } = harness;

    await queueEntry(harness, 'ORIGINAL');
    await service.retryDue(T0);

    expect(postingService.sent).toEqual([keyFor('ORIGINAL')]);
  });

  it('delivers in QUEUE ORDER — R-11', async () => {
    const harness = build();
    const { service, postingService } = harness;

    for (const label of ['A', 'B', 'C']) {
      await queueEntry(harness, label);
    }

    await service.retryDue(T0);

    expect(postingService.sent).toEqual([
      keyFor('A'),
      keyFor('B'),
      keyFor('C'),
    ]);
  });

  it('a retryable failure keeps the entry PENDING with a backoff — R-12', async () => {
    const harness = build();
    const { service, queue } = harness;

    await queueEntry(harness, 'RETRY');
    await service.retryDue(T0);

    const entry = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('RETRY')),
    );
    expect(entry?.state).toBe('PENDING');
    expect(entry?.attempts).toBe(1);
    // The first retry waits the base delay.
    expect(entry?.nextAttemptAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
  });

  it('an entry is NOT due until its backoff has expired — R-12', async () => {
    const harness = build();
    const { service, postingService } = harness;

    await queueEntry(harness, 'LATER');
    await service.retryDue(T0);

    // The backoff has not expired, so the next tick must not pick it up.
    postingService.sent.length = 0;
    await service.retryDue(T0.plus(500));
    expect(postingService.sent).toEqual([]);

    await service.retryDue(T0.plus(1000));
    expect(postingService.sent).toEqual([keyFor('LATER')]);
  });

  it('a delivered entry LEAVES the queue — the only way out', async () => {
    const harness = build({
      outcome: (p) => ({ kind: 'ACCEPTED', posting: p }),
    });
    const { service, queue } = harness;

    await queueEntry(harness, 'OK');
    await service.retryDue(T0);

    expect(
      await queue.findByPostingId(IdempotencyKey.of(keyFor('OK'))),
    ).toBeNull();
  });

  it('the count of unlanded consumptions is reported — R-04', async () => {
    const { service } = build();

    await service.enqueue(posting('ONE'));
    await service.enqueue(posting('TWO'));

    expect(await service.countUnlanded()).toBe(2);
  });
});

describe('SyncQueueService — the permanent failure (R-14)', () => {
  const rejecting = (p: ConsumptionPosting): PostingOutcome => ({
    kind: 'REJECTED',
    posting: p,
    reason: RejectionReason.of(
      'QUANTITY_OUT_OF_RANGE',
      'the quantity is not acceptable',
    ),
  });

  it('a FAILED entry is retained, visible and off the automatic path', async () => {
    const harness = build({
      disposition: 'PERMANENT',
      outcome: rejecting,
    });
    const { service, queue } = harness;

    await queueEntry(harness, 'FAIL');
    await service.retryDue(T0);

    const entry = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('FAIL')),
    );
    expect(entry).not.toBeNull();
    expect(entry?.state).toBe('FAILED');
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError?.code).toBe('REJECTED');
    // A failed entry is off the automatic path — no next attempt time.
    expect(entry?.nextAttemptAt).toBeNull();
  });

  it('a FAILED entry is never picked up by the retry worker', async () => {
    const harness = build({
      disposition: 'PERMANENT',
      outcome: rejecting,
    });
    const { service, postingService } = harness;

    await queueEntry(harness, 'FAIL');
    await service.retryDue(T0);

    postingService.sent.length = 0;
    await service.retryDue(T0.plus(60_000));
    expect(postingService.sent).toEqual([]);
  });

  it('a FAILED entry is still visible in the queue listing', async () => {
    const harness = build({
      disposition: 'PERMANENT',
      outcome: rejecting,
    });
    const { service } = harness;

    await queueEntry(harness, 'FAIL');
    await service.retryDue(T0);

    const all = await service.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.state).toBe('FAILED');
  });
});

describe('SyncQueueService — the re-drive (R-13)', () => {
  const rejecting = (p: ConsumptionPosting): PostingOutcome => ({
    kind: 'REJECTED',
    posting: p,
    reason: RejectionReason.of('UNMAPPED', 'not acceptable'),
  });

  /** The MES cannot be reached at all. */
  const unreachable = (p: ConsumptionPosting): PostingOutcome => ({
    kind: 'QUEUED',
    posting: p,
    message: 'OrgaTEX could not be reached',
  });

  it('a re-drive reuses the original key and never re-derives it', async () => {
    const harness = build({
      disposition: 'PERMANENT',
      outcome: rejecting,
    });
    const { service, postingService } = harness;

    await queueEntry(harness, 'REDRIVE');
    await service.retryDue(T0);

    postingService.sent.length = 0;
    const result = await service.redrive(
      IdempotencyKey.of(keyFor('REDRIVE')),
    );

    expect(result.outcome).toBe('ATTEMPTED');
    expect(postingService.sent).toEqual([keyFor('REDRIVE')]);
  });

  it('a re-drive of an unknown key is refused', async () => {
    const { service } = build();

    const result = await service.redrive(
      IdempotencyKey.of(keyFor('MISSING')),
    );

    expect(result.outcome).toBe('REFUSED');
    if (result.outcome !== 'REFUSED') return;
    expect(result.reason).toBe('NOT_FOUND');
  });

  it('a re-drive of a PENDING entry is refused — it is already on the path', async () => {
    const harness = build();
    const { service } = harness;

    await queueEntry(harness, 'PENDING');
    const result = await service.redrive(
      IdempotencyKey.of(keyFor('PENDING')),
    );

    expect(result.outcome).toBe('REFUSED');
    if (result.outcome !== 'REFUSED') return;
    expect(result.reason).toBe('NOT_FAILED');
  });

  it('a re-drive while the link is DOWN is refused and COUNTS as an attempt', async () => {
    const harness = build({
      disposition: 'PERMANENT',
      outcome: rejecting,
    });
    const { service, queue, contacts, postingService } = harness;

    await queueEntry(harness, 'DOWN');
    await service.retryDue(T0);

    // The link goes down — the observation records a failure.
    await contacts.recordFailure(
      SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
      T0,
    );

    // The MES is still unreachable, so the re-drive cannot reach it.
    postingService.outcome = unreachable;

    postingService.sent.length = 0;
    const result = await service.redrive(IdempotencyKey.of(keyFor('DOWN')));

    expect(result.outcome).toBe('REFUSED');
    if (result.outcome !== 'REFUSED') return;
    expect(result.reason).toBe('LINK_NOT_LINKED');

    // The re-drive IS the contact attempt — that is how it discovers the
    // MES is unreachable. So an attempt WAS made, with the entry's own
    // key and no other.
    expect(postingService.sent).toEqual([keyFor('DOWN')]);

    // And the attempt WAS counted, with the last error updated.
    const entry = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('DOWN')),
    );
    expect(entry?.attempts).toBe(2);
    expect(entry?.lastError?.code).toBe('UNREACHABLE');
    // The entry stays visible as failed — a refused re-drive never
    // discards it.
    expect(entry?.state).toBe('FAILED');
  });
});
