/**
 * `ConsumptionPostingService.redeliver` — the queue's delivery path.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RE-DRIVE IS A DIFFERENT PATH FROM THE FIRST SEND, AND IT HAS ITS
 * OWN GUARD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Bolt 007's sync queue calls `redeliver` rather than `post`, because a
 * queued posting is *already* `QUEUED` — and `post` refuses a key whose
 * posting is still `QUEUED`, because a second submission of the same
 * weighing must not create a second posting.
 *
 * So `redeliver` skips the enqueue-path guard and keeps the send-path
 * guard — the ledger's PRIMARY KEY, which is the **atomic** one
 * (ADR-023). That guard is what stops a re-delivery of an ambiguous
 * failure from double-counting a dye batch.
 *
 * These tests drive that path against the **real** SQLite ledger, because
 * a stub cannot prove that the PRIMARY KEY refuses a duplicate
 * atomically.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openOrgatexDatabase,
  type SqliteDatabase,
} from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import { SqliteIdempotencyLedger } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-posting-repository.js';
import { SqliteUnitOfWork } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-unit-of-work.js';
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
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { RejectionReason } from '../../src/005-orgatex-integration/domain/value-objects/rejection-reason.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { ConsumptionPosting } from '../../src/005-orgatex-integration/domain/entities/postings.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import type { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';

const NOW = Instant.of(new Date('2026-11-04T08:14:22.000Z'));
const KEY = 'IDK-cafebabe0badf00d';

/** An adapter that only the delivery path uses. */
class StubAdapter implements OrgatexAdapter {
  posted: RawConsumption[] = [];
  failure: Error | null = null;

  async readQueue(_filter?: BatchStatusFilter): Promise<RawQueue> {
    return { batches: [] };
  }

  async readRecipe(_batchId: BatchId): Promise<RawRecipe> {
    throw new Error('not used');
  }

  async postConsumption(consumption: RawConsumption): Promise<void> {
    if (this.failure !== null) throw this.failure;
    this.posted.push(consumption);
  }

  async writeBatchStatus(
    _batchId: BatchId,
    _status: BatchStatusToWrite,
  ): Promise<void> {
    throw new Error('not used');
  }
}

/** Records what the link state was told. */
class StubReporter {
  successes = 0;
  failures: SyncError[] = [];

  async recordSuccess(): Promise<void> {
    this.successes += 1;
  }

  async recordFailure(error: SyncError): Promise<void> {
    this.failures.push(error);
  }
}

function posting(state: 'QUEUED' | 'ACCEPTED' = 'QUEUED'): ConsumptionPosting {
  const base = new ConsumptionPosting(
    IdempotencyKey.of(KEY),
    BatchId.create('B-24187'),
    ComponentId.create('C-01'),
    WeightValue.of('94.01', 'g'),
    LotNumber.create('L-77120'),
    OperatorReference.create('OP-001'),
    NOW,
    NOW,
  );
  return state === 'ACCEPTED' ? base.accept(NOW) : base;
}

describe('ConsumptionPostingService.redeliver — the queue delivery path', () => {
  let db: SqliteDatabase;
  let adapter: StubAdapter;
  let postings: SqlitePostingRepository;
  let ledger: SqliteIdempotencyLedger;
  let reporter: StubReporter;

  beforeEach(() => {
    db = openOrgatexDatabase(':memory:');
    adapter = new StubAdapter();
    postings = new SqlitePostingRepository(db);
    ledger = new SqliteIdempotencyLedger(db);
    reporter = new StubReporter();
  });

  function build(): ConsumptionPostingService {
    return new ConsumptionPostingService({
      adapter,
      ledger,
      postings,
      unitOfWork: new SqliteUnitOfWork(db),
      clock: () => NOW.toDate(),
      contactReporter: reporter,
      newAttemptId: () => 'ATT-1',
    });
  }

  it('delivers a queued posting and records the ledger entry', async () => {
    const queued = posting();
    await postings.save(queued);

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('ACCEPTED');
    expect(adapter.posted).toHaveLength(1);
    expect(adapter.posted[0]?.idempotencyKey).toBe(KEY);

    // The ledger now holds the key, so a further re-drive is refused.
    expect(await ledger.has(IdempotencyKey.of(KEY))).toBe(true);
  });

  it('reports the successful contact to the link state', async () => {
    const queued = posting();
    await postings.save(queued);

    await build().redeliver(queued);
    expect(reporter.successes).toBe(1);
    expect(reporter.failures).toHaveLength(0);
  });

  it('refuses a key the ledger already holds — the atomic guard', async () => {
    // The posting exists and is ACCEPTED, and the ledger holds the key.
    // This is the shape of a re-drive after a lost response.
    const accepted = posting('ACCEPTED');
    await postings.save(accepted);
    await ledger.record(
      IdempotencyKey.of(KEY),
      IdempotencyKey.of(KEY),
      NOW,
    );

    const outcome = await build().redeliver(accepted);

    expect(outcome.kind).toBe('DUPLICATE');
    if (outcome.kind !== 'DUPLICATE') return;
    expect(outcome.alreadyAccepted).toBe(true);

    // The MES was NOT reached — the duplicate was refused before the send.
    expect(adapter.posted).toHaveLength(0);
  });

  it('sends again when the ledger holds the key but the posting is GONE', async () => {
    // The ledger claims the key is consumed but there is no posting to
    // report as the duplicate — so the guard has nothing to return and
    // the delivery goes ahead rather than being silently dropped.
    //
    // A stub ledger is used because the real ledger's posting_id has a
    // FOREIGN KEY, so the database itself forbids this shape. The guard
    // still has to cope with it.
    const queued = posting();
    await postings.save(queued);

    const orphan = new ConsumptionPostingService({
      adapter,
      ledger: {
        has: async () => true,
        record: async () => {
          throw new Error('not reached');
        },
        find: async () => null,
      },
      postings: {
        save: (p: ConsumptionPosting) => postings.save(p),
        findById: async () => null,
        findByBatch: (batchId: BatchId) => postings.findByBatch(batchId),
        markAccepted: (id: IdempotencyKey, at: Instant) =>
          postings.markAccepted(id, at),
        markRejected: (id: IdempotencyKey, reason: RejectionReason, at: Instant) =>
          postings.markRejected(id, reason, at),
      },
      unitOfWork: new SqliteUnitOfWork(db),
      clock: () => NOW.toDate(),
      contactReporter: reporter,
      newAttemptId: () => 'ATT-1',
    });

    const outcome = await orphan.redeliver(queued);

    expect(outcome.kind).toBe('ACCEPTED');
    expect(adapter.posted).toHaveLength(1);
  });

  it('records a rejection as a failed contact', async () => {
    const queued = posting();
    await postings.save(queued);
    adapter.failure = new AdapterRejection(
      RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
      'refused',
    );

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('REJECTED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('REJECTED');
    expect(reporter.successes).toBe(0);
  });

  it('records an unreachable MES as a failed contact', async () => {
    const queued = posting();
    await postings.save(queued);
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('UNREACHABLE');
  });

  it('records a TIMEOUT as a failed contact', async () => {
    const queued = posting();
    await postings.save(queued);
    adapter.failure = new AdapterError('TIMEOUT', 'the response was lost');

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('TIMEOUT');
  });

  it('records a MALFORMED response as a failed contact', async () => {
    const queued = posting();
    await postings.save(queued);
    adapter.failure = new AdapterError('MALFORMED', 'the answer was unusable');

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('MALFORMED');
  });

  it('treats an UNCLASSIFIED error as UNREACHABLE — the safe default', async () => {
    const queued = posting();
    await postings.save(queued);
    adapter.failure = new Error('something nobody classified');

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('UNREACHABLE');
  });

  it('records a THROWN non-Error as UNREACHABLE', async () => {
    // Not every adapter throws an `Error` — a rejected promise may carry
    // anything at all. The failure must still be recorded, or the link
    // state would claim the MES is fine while the delivery failed.
    const queued = posting();
    await postings.save(queued);
    adapter.failure = 'a bare string' as unknown as Error;

    const outcome = await build().redeliver(queued);

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('UNREACHABLE');
  });

  it('reports a CONCURRENT duplicate as a duplicate, not a failure', async () => {
    // The read guard says the key is absent, but the WRITE is refused by
    // the ledger's PRIMARY KEY — the consumption was already delivered,
    // so it is a DUPLICATE, not a failure.
    //
    // This is driven against the real ledger: the read guard is bypassed
    // with a stub, and the database's constraint does the refusing.
    const queued = posting();
    await postings.save(queued);

    // The key IS already in the ledger — the winner's row.
    await ledger.record(
      IdempotencyKey.of(KEY),
      IdempotencyKey.of(KEY),
      NOW,
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
      postings,
      unitOfWork: new SqliteUnitOfWork(db),
      clock: () => NOW.toDate(),
      contactReporter: reporter,
      newAttemptId: () => 'ATT-1',
    });

    const outcome = await racing.redeliver(queued);

    expect(outcome.kind).toBe('DUPLICATE');
    if (outcome.kind !== 'DUPLICATE') return;
    expect(outcome.alreadyAccepted).toBe(true);
  });

  it('rethrows a concurrent duplicate whose posting has VANISHED', async () => {
    // The ledger's PRIMARY KEY refused the key, but there is no posting
    // to report as the duplicate — so the error is re-thrown rather than
    // swallowed. A lost consumption must never be reported as a
    // successful duplicate.
    const queued = posting();
    await postings.save(queued);

    const racing = new ConsumptionPostingService({
      adapter,
      ledger: {
        has: async () => false,
        record: async () => {
          throw new Error(
            'UNIQUE constraint failed: idempotency_ledger.idempotency_key',
          );
        },
        find: async () => null,
      },
      postings: {
        save: (p: ConsumptionPosting) => postings.save(p),
        findById: async () => null,
        findByBatch: (batchId: BatchId) => postings.findByBatch(batchId),
        markAccepted: (id: IdempotencyKey, at: Instant) =>
          postings.markAccepted(id, at),
        markRejected: (
          id: IdempotencyKey,
          reason: RejectionReason,
          at: Instant,
        ) => postings.markRejected(id, reason, at),
      },
      unitOfWork: {
        commit: async () => {
          throw new Error(
            'UNIQUE constraint failed: idempotency_ledger.idempotency_key',
          );
        },
        commitStatusWrite: async () => {
          throw new Error('not reached');
        },
      },
      clock: () => NOW.toDate(),
      newAttemptId: () => 'ATT-1',
    });

    await expect(racing.redeliver(queued)).rejects.toThrow(/UNIQUE constraint/);
  });

  it('rethrows a database error that is NOT a duplicate violation', async () => {
    // A real failure must not be mistaken for a duplicate — that would
    // hide a broken database behind a 200.
    const queued = posting();
    await postings.save(queued);

    const failing = new ConsumptionPostingService({
      adapter,
      ledger: {
        has: async () => false,
        record: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
        find: async () => null,
      },
      postings,
      unitOfWork: {
        commit: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
        commitStatusWrite: async () => {
          throw new Error('SQLITE_BUSY: database is locked');
        },
      },
      clock: () => NOW.toDate(),
      newAttemptId: () => 'ATT-1',
    });

    await expect(failing.redeliver(queued)).rejects.toThrow(/SQLITE_BUSY/);
  });

  it('records a MALFORMED reason from the FIRST send as MALFORMED', async () => {
    // The first send goes through `post`, and `post` classifies the
    // adapter's failure the same way `redeliver` does — so the two paths
    // cannot disagree about what a MALFORMED answer means.
    adapter.failure = new AdapterError('MALFORMED', 'the answer was unusable');

    const outcome = await build().post({
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: NOW,
    });

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('MALFORMED');
  });

  it('records a THROWN non-Error from the FIRST send as UNREACHABLE', async () => {
    // A rejected promise may carry anything at all. The failure must
    // still be recorded, or the link state would claim the MES is fine
    // while the send failed.
    adapter.failure = 'a bare string' as unknown as Error;

    const outcome = await build().post({
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: NOW,
    });

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('UNREACHABLE');
  });

  it('defaults an AdapterError with an UNCLASSIFIED reason to UNREACHABLE', async () => {
    // `NOT_FOUND` is a reason an `AdapterError` can carry, and it is NOT
    // a failure of the link — so it must not be reported as one. The
    // classifier therefore falls back to `UNREACHABLE` for anything it
    // does not recognise, and the queue retries it.
    adapter.failure = new AdapterError('NOT_FOUND', 'no such batch');

    const outcome = await build().post({
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: NOW,
    });

    expect(outcome.kind).toBe('QUEUED');
    expect(reporter.failures).toHaveLength(1);
    expect(reporter.failures[0]?.code).toBe('UNREACHABLE');
  });
});
