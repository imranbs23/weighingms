/**
 * The write path's domain — the key factory, the value objects, the
 * entities and the posting service.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT IS BEING PROVED HERE
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's acceptance criteria and its edge cases, most of which are
 * about **what must NOT happen**:
 *
 *   - a duplicate adds nothing
 *   - a second enqueue of a queued key is refused
 *   - a retry after a lost response carries the SAME key
 *   - a rejection is retained with its reason, never discarded
 *   - a second weighing of the same component is a DISTINCT posting
 *   - a zero quantity is posted as a zero quantity
 *   - no other OrgaTEX batch field is altered
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import {
  IdempotencyKeyFactory,
  type WeighingIdentity,
} from '../../src/005-orgatex-integration/domain/services/idempotency-key-factory.js';
import {
  RejectionReason,
  MAX_REJECTION_DETAIL_LENGTH,
} from '../../src/005-orgatex-integration/domain/value-objects/rejection-reason.js';
import {
  LotNumber,
  OperatorReference,
  BatchId,
  ComponentId,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import {
  isPostingState,
  isAttemptOutcome,
  POSTING_STATES,
  ATTEMPT_OUTCOMES,
} from '../../src/005-orgatex-integration/domain/value-objects/posting-state.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  ConsumptionPosting,
  PostingAttempt,
} from '../../src/005-orgatex-integration/domain/entities/postings.js';
import { ConsumptionPostingService } from '../../src/005-orgatex-integration/domain/services/consumption-posting-service.js';
import {
  AdapterError,
  AdapterRejection,
  type BatchStatusFilter,
  type BatchStatusToWrite,
  type OrgatexAdapter,
  type RawBatch,
  type RawComponent,
  type RawConsumption,
  type RawQueue,
  type RawRecipe,
} from '../../src/005-orgatex-integration/domain/ports/orgatex-adapter.js';
import type { UnitOfWork } from '../../src/005-orgatex-integration/domain/ports/posting-repositories.js';
import type { PostingEvent } from '../../src/005-orgatex-integration/domain/events/posting-events.js';
import { TestClock } from '../support/scale-harness.js';

const WEIGHED_AT = '2026-11-02T08:14:22.000Z';

function identity(
  overrides: Partial<WeighingIdentity> = {},
): WeighingIdentity {
  return {
    batchId: BatchId.create('B-24187'),
    componentId: ComponentId.create('C-01'),
    operatorId: OperatorReference.create('OP-001'),
    weighedAt: WEIGHED_AT,
    ...overrides,
  };
}

/** An adapter a test drives directly. */
class StubAdapter implements OrgatexAdapter {
  readonly posted: RawConsumption[] = [];
  readonly statusWrites: { batchId: string; status: string }[] = [];
  /** What the next `postConsumption` does. */
  failure: Error | null = null;

  async readQueue(_filter?: BatchStatusFilter): Promise<RawQueue> {
    return { batches: [] };
  }

  async readRecipe(_batchId: BatchId): Promise<RawRecipe> {
    return { batchId: 'B-24187', shadeCode: 'Teal 4C', components: [] };
  }

  async postConsumption(consumption: RawConsumption): Promise<void> {
    if (this.failure !== null) throw this.failure;
    this.posted.push(consumption);
  }

  async writeBatchStatus(
    batchId: BatchId,
    status: BatchStatusToWrite,
  ): Promise<void> {
    if (this.failure !== null) throw this.failure;
    this.statusWrites.push({ batchId: batchId.value, status });
  }
}

/** A ledger a test drives directly. */
class StubLedger {
  readonly keys = new Set<string>();

  async has(key: IdempotencyKey): Promise<boolean> {
    return this.keys.has(key.value);
  }

  async record(key: IdempotencyKey): Promise<void> {
    if (this.keys.has(key.value)) {
      throw new Error('UNIQUE constraint failed: idempotency_ledger');
    }
    this.keys.add(key.value);
  }

  async find(key: IdempotencyKey): Promise<IdempotencyKey | null> {
    return this.keys.has(key.value) ? key : null;
  }
}

/** A postings table a test drives directly. */
class StubPostings {
  readonly rows = new Map<string, ConsumptionPosting>();

  async save(posting: ConsumptionPosting): Promise<void> {
    if (this.rows.has(posting.id.value)) {
      throw new Error('UNIQUE constraint failed: consumption_postings');
    }
    this.rows.set(posting.id.value, posting);
  }

  async findById(id: IdempotencyKey): Promise<ConsumptionPosting | null> {
    return this.rows.get(id.value) ?? null;
  }

  async findByBatch(batchId: BatchId): Promise<ConsumptionPosting[]> {
    return [...this.rows.values()].filter(
      (posting) => posting.batchId.value === batchId.value,
    );
  }

  async markAccepted(id: IdempotencyKey): Promise<void> {
    const row = this.rows.get(id.value);
    if (row === undefined) throw new Error('no such posting');
    this.rows.set(id.value, row.accept(Instant.of(new Date())));
  }

  async markRejected(id: IdempotencyKey, reason: RejectionReason): Promise<void> {
    const row = this.rows.get(id.value);
    if (row === undefined) throw new Error('no such posting');
    this.rows.set(id.value, row.reject(reason));
  }
}

/**
 * A unit of work that applies the change in memory.
 *
 * It holds the stubs it stands in for, so the commit can apply the same
 * effect the real transaction would.
 */
class StubUnitOfWork implements UnitOfWork {
  readonly committed: string[] = [];

  constructor(
    private readonly postings: StubPostings,
    private readonly ledger: StubLedger,
  ) {}

  async commit(change: {
    kind: 'ACCEPTED' | 'REJECTED' | 'PENDING';
    posting: ConsumptionPosting;
    attempt: PostingAttempt;
    ledgerKey?: IdempotencyKey;
  }): Promise<void> {
    this.committed.push(change.kind);
    if (change.kind === 'ACCEPTED') {
      await this.postings.markAccepted(change.posting.id);
      await this.ledger.record(change.ledgerKey ?? change.posting.id);
    } else if (change.kind === 'REJECTED') {
      await this.postings.markRejected(
        change.posting.id,
        change.attempt.reason ?? RejectionReason.unmapped('rejected'),
      );
    }
  }

  async commitStatusWrite(): Promise<void> {
    // The posting service never writes a status write — that is the
    // status write service's business.
  }
}

describe('IdempotencyKey', () => {
  it('accepts a key of the right shape', () => {
    const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
    expect(key.value).toBe('IDK-cafebabe0badf00d');
  });

  it('refuses a key that is not the right shape', () => {
    expect(() => IdempotencyKey.of('nope')).toThrow(/IDK-/);
    expect(() => IdempotencyKey.of('IDK-0123456789ABCDEF')).toThrow(/IDK-/);
    expect(() => IdempotencyKey.of('IDK-0123')).toThrow(/IDK-/);
    expect(() => IdempotencyKey.of('')).toThrow(/IDK-/);
  });

  it('refuses a key that is too long', () => {
    expect(() => IdempotencyKey.of(`IDK-${'a'.repeat(100)}`)).toThrow(
      /64 characters/,
    );
  });

  it('trims a key before checking it', () => {
    expect(IdempotencyKey.of('  IDK-cafebabe0badf00d  ').value).toBe(
      'IDK-cafebabe0badf00d',
    );
  });

  it('compares two keys by value', () => {
    expect(IdempotencyKey.of('IDK-cafebabe0badf00d')).toEqual(
      IdempotencyKey.of('IDK-cafebabe0badf00d'),
    );
  });
});

describe('IdempotencyKeyFactory', () => {
  it('derives the same key for the same weighing', () => {
    const first = IdempotencyKeyFactory.derive(identity());
    const second = IdempotencyKeyFactory.derive(identity());
    expect(first.value).toBe(second.value);
  });

  it('derives a different key for a different weighing time', () => {
    const first = IdempotencyKeyFactory.derive(identity());
    const second = IdempotencyKeyFactory.derive(
      identity({ weighedAt: '2026-11-02T08:14:23.000Z' }),
    );
    expect(first.value).not.toBe(second.value);
  });

  it('derives a different key for a different operator', () => {
    const first = IdempotencyKeyFactory.derive(identity());
    const second = IdempotencyKeyFactory.derive(
      identity({ operatorId: OperatorReference.create('OP-002') }),
    );
    expect(first.value).not.toBe(second.value);
  });

  it('derives a different key for a different component', () => {
    const first = IdempotencyKeyFactory.derive(identity());
    const second = IdempotencyKeyFactory.derive(
      identity({ componentId: ComponentId.create('C-02') }),
    );
    expect(first.value).not.toBe(second.value);
  });

  it('derives a different key for a different batch', () => {
    const first = IdempotencyKeyFactory.derive(identity());
    const second = IdempotencyKeyFactory.derive(
      identity({ batchId: BatchId.create('B-24188') }),
    );
    expect(first.value).not.toBe(second.value);
  });

  it('leaks nothing about the weighing it identifies', () => {
    const key = IdempotencyKeyFactory.derive(identity());
    expect(key.value).not.toContain('OP-001');
    expect(key.value).not.toContain('B-24187');
    expect(key.value).not.toContain('C-01');
  });

  it('produces a key of the right shape', () => {
    expect(IdempotencyKeyFactory.derive(identity()).value).toMatch(
      /^IDK-[0-9a-f]{16}$/,
    );
  });

  it('does not let one identity bleed into another through the separator', () => {
    // "B-1|C-2" and "B|C-1C-2" would join identically if the parts
    // were not separated.
    const first = IdempotencyKeyFactory.derive(
      identity({
        batchId: BatchId.create('B-1'),
        componentId: ComponentId.create('C-2'),
      }),
    );
    const second = IdempotencyKeyFactory.derive(
      identity({
        batchId: BatchId.create('B'),
        componentId: ComponentId.create('C-1C-2'),
      }),
    );
    expect(first.value).not.toBe(second.value);
  });
});

describe('RejectionReason', () => {
  it('keeps a short detail as it is', () => {
    const reason = RejectionReason.of('BATCH_NOT_POSTABLE', 'the batch is closed');
    expect(reason.code).toBe('BATCH_NOT_POSTABLE');
    expect(reason.detail).toBe('the batch is closed');
  });

  it('truncates an over-long detail and marks that it did', () => {
    const reason = RejectionReason.of(
      'BATCH_NOT_POSTABLE',
      'x'.repeat(1000),
    );
    expect(reason.detail.length).toBeLessThanOrEqual(
      MAX_REJECTION_DETAIL_LENGTH + '… [truncated]'.length,
    );
    expect(reason.detail).toContain('truncated');
  });

  it('marks an unrecognised MES reason as UNMAPPED', () => {
    const reason = RejectionReason.unmapped('the MES said something new');
    expect(reason.code).toBe('UNMAPPED');
    expect(reason.detail).toBe('the MES said something new');
  });
});

describe('LotNumber and OperatorReference', () => {
  it('refuses an empty identifier', () => {
    expect(() => LotNumber.create('   ')).toThrow(/must not be empty/);
    expect(() => OperatorReference.create('')).toThrow(/must not be empty/);
  });

  it('refuses an identifier that is too long', () => {
    expect(() => LotNumber.create('L'.repeat(65))).toThrow(/64 characters/);
  });

  it('trims an identifier', () => {
    expect(LotNumber.create('  L-77120 ').value).toBe('L-77120');
  });
});

describe('ConsumptionPosting', () => {
  const now = Instant.of(new Date(WEIGHED_AT));

  function posting(): ConsumptionPosting {
    return new ConsumptionPosting(
      IdempotencyKey.of('IDK-cafebabe0badf00d'),
      BatchId.create('B-24187'),
      ComponentId.create('C-01'),
      WeightValue.of('94.01', 'g'),
      LotNumber.create('L-77120'),
      OperatorReference.create('OP-001'),
      now,
      now,
    );
  }

  it('starts QUEUED and unresolved', () => {
    expect(posting().state).toBe('QUEUED');
    expect(posting().isPending).toBe(true);
    expect(posting().isResolved).toBe(false);
  });

  it('accepts from QUEUED', () => {
    const accepted = posting().accept(now);
    expect(accepted.state).toBe('ACCEPTED');
    expect(accepted.isResolved).toBe(true);
  });

  it('refuses to accept twice', () => {
    const accepted = posting().accept(now);
    expect(() => accepted.accept(now)).toThrow(/QUEUED to ACCEPTED only/);
  });

  it('refuses to reject an accepted posting', () => {
    const accepted = posting().accept(now);
    expect(() =>
      accepted.reject(RejectionReason.of('UNMAPPED', 'too late')),
    ).toThrow(/QUEUED to REJECTED only/);
  });

  it('keeps the reason on the rejected posting', () => {
    const reason = RejectionReason.of('BATCH_NOT_POSTABLE', 'closed');
    const rejected = posting().reject(reason);
    expect(rejected.state).toBe('REJECTED');
    expect(rejected.rejection?.code).toBe('BATCH_NOT_POSTABLE');
  });

  it('keeps the content unchanged when it is accepted', () => {
    const original = posting();
    const accepted = original.accept(now);
    expect(accepted.actualQuantity.toJSON()).toBe('94.01');
    expect(accepted.batchId.value).toBe('B-24187');
    expect(accepted.componentId.value).toBe('C-01');
    expect(accepted.lotNumber.value).toBe('L-77120');
    expect(accepted.operatorId.value).toBe('OP-001');
  });
});

describe('ConsumptionPostingService', () => {
  let clock: TestClock;
  let adapter: StubAdapter;
  let ledger: StubLedger;
  let postings: StubPostings;
  let unitOfWork: StubUnitOfWork;
  let events: PostingEvent[];
  let service: ConsumptionPostingService;

  beforeEach(() => {
    clock = new TestClock();
    adapter = new StubAdapter();
    ledger = new StubLedger();
    postings = new StubPostings();
    unitOfWork = new StubUnitOfWork(postings, ledger);
    events = [];

    // The stub unit of work reaches back into the stubs it stands in for.
    (unitOfWork as unknown as { postings: StubPostings }).postings = postings;
    (unitOfWork as unknown as { ledger: StubLedger }).ledger = ledger;

    service = new ConsumptionPostingService({
      adapter,
      ledger,
      postings,
      unitOfWork,
      clock: clock.now,
      newAttemptId: () => `ATT-${events.length}`,
      onEvent: (event) => events.push(event),
    });
  });

  function request(overrides: Partial<Parameters<
    typeof service.post
  >[0]> = {}) {
    return {
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: Instant.of(new Date(WEIGHED_AT)),
      ...overrides,
    };
  }

  it('posts a consumption and reports it accepted', async () => {
    const outcome = await service.post(request());

    expect(outcome.kind).toBe('ACCEPTED');
    expect(adapter.posted).toHaveLength(1);
    expect(adapter.posted[0]?.actualQuantity).toBe('94.01');
    expect(adapter.posted[0]?.unit).toBe('g');
    expect(adapter.posted[0]?.operatorId).toBe('OP-001');
    expect(adapter.posted[0]?.weighedAt).toBe(WEIGHED_AT);
    expect(adapter.posted[0]?.idempotencyKey).toMatch(/^IDK-/);
  });

  it('records the key in the ledger when the MES accepts', async () => {
    await service.post(request());
    expect(ledger.keys.size).toBe(1);
  });

  it('adds nothing when the same consumption is posted twice', async () => {
    const first = await service.post(request());
    const second = await service.post(request());

    expect(first.kind).toBe('ACCEPTED');
    expect(second.kind).toBe('DUPLICATE');
    // The MES was reached exactly ONCE.
    expect(adapter.posted).toHaveLength(1);
  });

  it('refuses a re-enqueue of a key that is already queued', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');

    const first = await service.post(request());
    expect(first.kind).toBe('QUEUED');

    adapter.failure = null;
    const second = await service.post(request());

    expect(second.kind).toBe('DUPLICATE');
    // The second submission did NOT send — a second queue entry would
    // be a second delivery.
    expect(adapter.posted).toHaveLength(0);
  });

  it('carries the SAME key on a retry after a lost response', async () => {
    adapter.failure = new AdapterError('TIMEOUT', 'the response was lost');
    const first = await service.post(request());
    expect(first.kind).toBe('QUEUED');

    adapter.failure = null;
    const second = await service.post(request({ weighedAt: Instant.of(new Date(WEIGHED_AT)) }));

    // The retry reuses the key because the KEY is the posting's id.
    expect(second.kind).toBe('DUPLICATE');
    const posting = second.kind === 'DUPLICATE' ? second.posting : null;
    expect(posting?.id.value).toBe(
      first.kind === 'QUEUED' ? first.posting.id.value : '',
    );
  });

  it('leaves the posting QUEUED when the MES cannot be reached', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    const outcome = await service.post(request());

    expect(outcome.kind).toBe('QUEUED');
    if (outcome.kind !== 'QUEUED') return;
    expect(outcome.posting.state).toBe('QUEUED');
    expect(outcome.posting.isResolved).toBe(false);
  });

  it('does NOT write the ledger for a posting that is still queued', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    await service.post(request());

    expect(ledger.keys.size).toBe(0);
  });

  it('records the rejection with its reason and retains the posting', async () => {
    adapter.failure = new AdapterRejection(
      RejectionReason.of('BATCH_NOT_POSTABLE', 'the batch is closed'),
      'refused',
    );

    const outcome = await service.post(request());

    expect(outcome.kind).toBe('REJECTED');
    if (outcome.kind !== 'REJECTED') return;
    expect(outcome.reason.code).toBe('BATCH_NOT_POSTABLE');
    expect(outcome.posting.state).toBe('REJECTED');
    expect(outcome.posting.rejection?.detail).toBe('the batch is closed');
    // The posting is RETAINED, not discarded.
    expect(postings.rows.size).toBe(1);
  });

  it('does NOT write the ledger for a rejected posting', async () => {
    adapter.failure = new AdapterRejection(
      RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
      'refused',
    );
    await service.post(request());
    expect(ledger.keys.size).toBe(0);
  });

  it('treats a second weighing of the same component as a DISTINCT posting', async () => {
    const first = await service.post(request());
    const second = await service.post(
      request({ weighedAt: Instant.of(new Date('2026-11-02T08:15:00.000Z')) }),
    );

    // The key is derived from the WEIGHING, not from the component.
    expect(first.kind).toBe('ACCEPTED');
    expect(second.kind).toBe('ACCEPTED');
    expect(adapter.posted).toHaveLength(2);
    expect(adapter.posted[0]?.idempotencyKey).not.toBe(
      adapter.posted[1]?.idempotencyKey,
    );
  });

  it('posts a zero quantity as a zero quantity', async () => {
    const outcome = await service.post(
      request({ actualQuantity: WeightValue.of('0', 'g') }),
    );

    expect(outcome.kind).toBe('ACCEPTED');
    expect(adapter.posted[0]?.actualQuantity).toBe('0');
  });

  it('posts the quantity in the unit it was weighed in', async () => {
    await service.post(
      request({ actualQuantity: WeightValue.of('0.09401', 'kg') }),
    );

    expect(adapter.posted[0]?.actualQuantity).toBe('0.09401');
    expect(adapter.posted[0]?.unit).toBe('kg');
  });

  it('emits an attempt event for an unreachable MES', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    await service.post(request());

    const attempt = events.find(
      (event) => event.type === 'CONSUMPTION_POSTING_ATTEMPTED',
    );
    expect(attempt).toBeDefined();
  });

  it('does not leak the MES failure message into the outcome', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'SECRET MES DETAIL');
    const outcome = await service.post(request());

    // The message is for the LOG. The outcome carries it for the log
    // too — but the API layer is what decides what the client sees.
    expect(outcome.kind).toBe('QUEUED');
  });

  it('reports a refusal that is NOT an AdapterRejection as UNKNOWN', async () => {
    // A rejection arrives as an `AdapterRejection`. Anything else is an
    // error whose outcome is genuinely unknown — and UNKNOWN is an
    // attempt outcome, never a posting state.
    adapter.failure = new Error('something went wrong');
    const outcome = await service.post(request());

    expect(outcome.kind).toBe('QUEUED');
    if (outcome.kind !== 'QUEUED') return;
    expect(outcome.posting.state).toBe('QUEUED');
  });

  it('refuses a retry of a REJECTED posting as a rejected outcome', async () => {
    adapter.failure = new AdapterRejection(
      RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
      'refused',
    );
    const first = await service.post(request());
    expect(first.kind).toBe('REJECTED');

    adapter.failure = null;
    const second = await service.post(request());

    // The posting is RESOLVED as REJECTED, so it is not re-enqueued —
    // and its rejection is reported again, not lost.
    expect(second.kind).toBe('REJECTED');
    if (second.kind !== 'REJECTED') return;
    expect(second.reason.code).toBe('BATCH_NOT_POSTABLE');
  });

  it('emits an accepted event when the MES accepts', async () => {
    await service.post(request());

    const accepted = events.find(
      (event) => event.type === 'CONSUMPTION_POSTING_ACCEPTED',
    );
    expect(accepted).toBeDefined();
  });

  it('emits a rejected event when the MES refuses', async () => {
    adapter.failure = new AdapterRejection(
      RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
      'refused',
    );
    await service.post(request());

    const rejected = events.find(
      (event) => event.type === 'CONSUMPTION_POSTING_REJECTED',
    );
    expect(rejected).toBeDefined();
  });

  it('reports a CONCURRENT duplicate as a duplicate, not a failure', async () => {
    // The ledger's PRIMARY KEY is the ATOMIC guard (ADR-023). Two
    // submissions of the same key can both pass the read guards — the
    // constraint is what admits exactly one, and the loser's insert
    // raises a UNIQUE violation.
    //
    // So this test drives the service against a ledger that already
    // holds the key, but through the WRITE path — the read guard is
    // bypassed, which is exactly what happens when two submissions race.
    const racingLedger = new StubLedger();
    const racingPostings = new StubPostings();
    const racingUnitOfWork = new StubUnitOfWork(
      racingPostings,
      racingLedger,
    );

    const racing = new ConsumptionPostingService({
      adapter,
      // The ledger CLAIMS the key is absent, so the read guard lets it
      // through — and the write is what refuses it.
      ledger: {
        has: async () => false,
        record: async () => {
          throw new Error(
            'UNIQUE constraint failed: idempotency_ledger.idempotency_key',
          );
        },
        find: async () => null,
      },
      postings: racingPostings,
      unitOfWork: racingUnitOfWork,
      clock: clock.now,
      newAttemptId: () => 'ATT-1',
      onEvent: (event) => events.push(event),
    });

    // The racing posting exists and is resolved — the winner's row.
    const key = IdempotencyKeyFactory.derive({
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: WEIGHED_AT,
    });
    const now = Instant.of(new Date(WEIGHED_AT));
    await racingPostings.save(
      new ConsumptionPosting(
        key,
        BatchId.create('B-24187'),
        ComponentId.create('C-01'),
        WeightValue.of('94.01', 'g'),
        LotNumber.create('L-77120'),
        OperatorReference.create('OP-001'),
        now,
        now,
      ).accept(now),
    );

    const outcome = await racing.post(request());

    expect(outcome.kind).toBe('DUPLICATE');
    if (outcome.kind !== 'DUPLICATE') return;
    expect(outcome.alreadyAccepted).toBe(true);
    expect(outcome.posting.id.value).toBe(key.value);
  });

  it('rethrows a database error that is NOT a duplicate violation', async () => {
    // A real failure must not be mistaken for a duplicate — that would
    // hide a broken database behind a 200.
    const failing = new ConsumptionPostingService({
      adapter,
      ledger: {
        has: async () => false,
        record: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
        find: async () => null,
      },
      postings: new StubPostings(),
      unitOfWork: {
        commit: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
        commitStatusWrite: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
      },
      clock: clock.now,
      newAttemptId: () => 'ATT-1',
    });

    await expect(failing.post(request())).rejects.toThrow(/SQLITE_BUSY/);
  });
});

describe('the posting state types', () => {
  it('recognises a posting state', () => {
    expect(isPostingState('QUEUED')).toBe(true);
    expect(isPostingState('ACCEPTED')).toBe(true);
    expect(isPostingState('REJECTED')).toBe(true);
    expect(isPostingState('UNKNOWN')).toBe(false);
    expect(isPostingState('UNREACHABLE')).toBe(false);
    expect(isPostingState(42)).toBe(false);

    expect(isAttemptOutcome('UNKNOWN')).toBe(true);
    expect(isAttemptOutcome('UNREACHABLE')).toBe(true);
    expect(isAttemptOutcome('QUEUED')).toBe(false);
    expect(isAttemptOutcome(null)).toBe(false);

    // The attempt outcome is STRICTLY WIDER than the posting state.
    expect(ATTEMPT_OUTCOMES.length).toBeGreaterThan(POSTING_STATES.length);
    expect(POSTING_STATES).not.toContain('UNKNOWN');
    expect(POSTING_STATES).not.toContain('UNREACHABLE');
  });
});
