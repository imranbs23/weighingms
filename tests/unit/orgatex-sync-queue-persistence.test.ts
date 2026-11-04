/**
 * The queue's persistence (R-10, R-16).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUEUE IS DURABLE. THE SNAPSHOTS ARE NOT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A snapshot can always be re-fetched — an unlanded consumption posting
 * cannot. So this file proves that the queue survives an immediate restart
 * with its **original** key, its original content and its original
 * `queuedAt`, and that the quantities come back as the exact decimals that
 * went in (NFR-16).
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { SyncQueueEntry } from '../../src/005-orgatex-integration/domain/entities/sync-queue-entry.js';
import { openOrgatexDatabase } from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import { SqliteSyncQueueRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-sync-queue-repository.js';

const T0 = Instant.of(new Date('2026-11-03T09:00:00.000Z'));

function keyFor(label: string): string {
  let hash = 0;
  for (const char of label) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `IDK-${hash.toString(16).padStart(16, '0').slice(0, 16)}`;
}

function entryFor(
  label: string,
  options?: { readonly quantity?: string; readonly queuedAt?: Instant },
): SyncQueueEntry {
  return SyncQueueEntry.queue({
    postingId: IdempotencyKey.of(keyFor(label)),
    batchId: BatchId.create('B-24187'),
    componentId: ComponentId.create('C-01'),
    actualQuantity: WeightValue.of(options?.quantity ?? '94.01', 'g'),
    lotNumber: LotNumber.create('L-77120'),
    operatorId: OperatorReference.create('OP-001'),
    weighedAt: T0,
    queuedAt: options?.queuedAt ?? T0,
  });
}

describe('the sync queue survives a restart (R-10)', () => {
  it('the entry is still there after a restart, with the SAME key', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('DURABLE'));

    // A NEW repository over the same database — the equivalent of a
    // restart. Nothing is re-derived and no key is re-generated.
    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('DURABLE')),
    );

    expect(found).not.toBeNull();
    expect(found?.postingId.value).toBe(keyFor('DURABLE'));
  });

  it('the entry keeps its ORIGINAL content — nothing is re-derived (R-10)', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('CONTENT'));

    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('CONTENT')),
    );

    expect(found?.batchId.value).toBe('B-24187');
    expect(found?.componentId.value).toBe('C-01');
    expect(found?.lotNumber.value).toBe('L-77120');
    expect(found?.operatorId.value).toBe('OP-001');
    expect(found?.weighedAt.epochMillis).toBe(T0.epochMillis);
    expect(found?.queuedAt.epochMillis).toBe(T0.epochMillis);
  });

  it('the quantity comes back EXACTLY — no float rounding (NFR-16)', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    // A quantity a float would round: 94.015 is not 94.014999999999995.
    await queue.enqueue(entryFor('EXACT', { quantity: '94.015' }));

    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('EXACT')),
    );

    expect(found?.actualQuantity.toJSON()).toBe('94.015');
    expect(found?.actualQuantity.unit).toBe('g');
  });

  it('a queued entry is PENDING, with no attempts yet', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('PENDING'));

    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('PENDING')),
    );

    expect(found?.state).toBe('PENDING');
    expect(found?.attempts).toBe(0);
    expect(found?.lastAttemptAt).toBeNull();
    expect(found?.nextAttemptAt).not.toBeNull();
    expect(found?.lastError).toBeNull();
  });
});

describe('the queue order is a TOTAL order (R-11, OQ-4)', () => {
  it('entries queued in the same millisecond still have a defined order', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    // Two entries, the SAME queuedAt — the tie-breaker decides.
    await queue.enqueue(entryFor('ZZZ', { queuedAt: T0 }));
    await queue.enqueue(entryFor('AAA', { queuedAt: T0 }));

    const all = await queue.findAll();

    // The order is by posting_id, so it is the same on every read.
    const ids = all.map((entry) => entry.postingId.value);
    expect(ids).toEqual([...ids].sort());
  });

  it('the order is the SAME after a restart', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('THIRD', { queuedAt: T0.plus(2000) }));
    await queue.enqueue(entryFor('FIRST', { queuedAt: T0 }));
    await queue.enqueue(entryFor('SECOND', { queuedAt: T0.plus(1000) }));

    const before = (await queue.findAll()).map((e) => e.postingId.value);

    const reopened = new SqliteSyncQueueRepository(db);
    const after = (await reopened.findAll()).map((e) => e.postingId.value);

    expect(after).toEqual(before);
    expect(before).toEqual([
      keyFor('FIRST'),
      keyFor('SECOND'),
      keyFor('THIRD'),
    ]);
  });
});

describe('the attempt bookkeeping moves; the content does not (ADR-024)', () => {
  it('a recorded attempt keeps the count, the time and the error', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('ATTEMPT'));
    const error = SyncError.of('TIMEOUT', 'OrgaTEX did not answer in time', 'raw detail');

    await queue.recordAttempt({
      postingId: IdempotencyKey.of(keyFor('ATTEMPT')),
      outcome: 'RETRYABLE',
      error,
      attemptedAt: T0.plus(1000),
      nextAttemptAt: T0.plus(2000),
      attempts: 1,
    });

    const found = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('ATTEMPT')),
    );

    expect(found?.attempts).toBe(1);
    expect(found?.lastAttemptAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
    expect(found?.nextAttemptAt?.epochMillis).toBe(T0.plus(2000).epochMillis);
    expect(found?.lastError?.code).toBe('TIMEOUT');
    expect(found?.lastError?.detail).toBe('raw detail');
    // The content is untouched.
    expect(found?.actualQuantity.toJSON()).toBe('94.01');
    expect(found?.state).toBe('PENDING');
  });

  it('an entry whose error has NO summary or detail still reads back', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('HALF'));

    // A half-written row: the code is there, the prose is not. The
    // repository must not lose the code, and must not throw on the
    // missing prose.
    db.prepare(
      `UPDATE sync_queue_entries
          SET last_error_code = 'UNREACHABLE',
              last_error_summary = NULL,
              last_error_detail = NULL
        WHERE posting_id = ?`,
    ).run(keyFor('HALF'));

    const found = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('HALF')),
    );

    expect(found?.lastError?.code).toBe('UNREACHABLE');
    expect(found?.lastError?.summary).toBe('');
    expect(found?.lastError?.detail).toBe('');
  });

  it('a queue entry can be enqueued with NO next attempt time', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    // A FAILED entry has no next attempt time — so the `enqueue` path's
    // `?? null` branch is the one a durable queue actually takes.
    const failed = SyncQueueEntry.restore({
      postingId: IdempotencyKey.of(keyFor('NO_NEXT')),
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: T0,
      queuedAt: T0,
      attempts: 1,
      lastAttemptAt: T0,
      nextAttemptAt: null,
      lastError: SyncError.of('REJECTED', 'OrgaTEX refused', 'detail'),
      state: 'FAILED',
    });

    await queue.enqueue(failed);

    const found = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('NO_NEXT')),
    );

    expect(found?.state).toBe('FAILED');
    expect(found?.nextAttemptAt).toBeNull();
    expect(found?.lastError?.code).toBe('REJECTED');
  });

  it('an entry with NO error and NO last attempt is enqueued as a FRESH entry', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    // A brand-new entry has no last attempt time and no error — so both
    // of the repository's `?? null` branches are the ones it takes.
    await queue.enqueue(entryFor('FRESH'));

    const found = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('FRESH')),
    );

    expect(found?.lastAttemptAt).toBeNull();
    expect(found?.lastError).toBeNull();
    expect(found?.nextAttemptAt).not.toBeNull();
  });

  it('a FAILED entry is retained with its error — it is never discarded', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('FAILED'));

    await queue.markFailed({
      postingId: IdempotencyKey.of(keyFor('FAILED')),
      error: SyncError.of('REJECTED', 'OrgaTEX refused', 'raw detail'),
      attemptedAt: T0.plus(1000),
      attempts: 1,
    });

    const reopened = new SqliteSyncQueueRepository(db);
    const found = await reopened.findByPostingId(
      IdempotencyKey.of(keyFor('FAILED')),
    );

    expect(found).not.toBeNull();
    expect(found?.state).toBe('FAILED');
    expect(found?.attempts).toBe(1);
    expect(found?.lastError?.code).toBe('REJECTED');
    // A FAILED entry is off the automatic path.
    expect(found?.nextAttemptAt).toBeNull();
  });

  it('a FAILED entry is NEVER due — the automatic path skips it', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('SKIPPED'));
    await queue.markFailed({
      postingId: IdempotencyKey.of(keyFor('SKIPPED')),
      error: SyncError.of('REJECTED', 'OrgaTEX refused', 'raw detail'),
      attemptedAt: T0.plus(1000),
      attempts: 1,
    });

    const due = await queue.findDue(T0.plus(60_000), 10);
    expect(due).toHaveLength(0);
  });

  it('rescheduling a FAILED entry is refused — it is off the automatic path', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('RESCHEDULE'));
    await queue.markFailed({
      postingId: IdempotencyKey.of(keyFor('RESCHEDULE')),
      error: SyncError.of('REJECTED', 'OrgaTEX refused', 'raw detail'),
      attemptedAt: T0.plus(1000),
      attempts: 1,
    });

    await expect(
      queue.reschedule(
        IdempotencyKey.of(keyFor('RESCHEDULE')),
        T0.plus(60_000),
      ),
    ).rejects.toThrow();
  });

  it('rescheduling a PENDING entry moves its next attempt time', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('MOVED'));

    // A PENDING entry IS on the automatic path, so its next attempt time
    // is the one thing that may be moved.
    await queue.reschedule(
      IdempotencyKey.of(keyFor('MOVED')),
      T0.plus(60_000),
    );

    const found = await queue.findByPostingId(
      IdempotencyKey.of(keyFor('MOVED')),
    );

    expect(found?.state).toBe('PENDING');
    expect(found?.nextAttemptAt?.epochMillis).toBe(T0.plus(60_000).epochMillis);
  });

  it('removing an entry that does not exist is REFUSED, not silently ignored', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await expect(
      queue.remove(IdempotencyKey.of(keyFor('MISSING'))),
    ).rejects.toThrow();
  });

  it('recording an attempt against nothing is REFUSED, not silently ignored', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await expect(
      queue.recordAttempt({
        postingId: IdempotencyKey.of(keyFor('MISSING')),
        outcome: 'DELIVERED',
        error: null,
        attemptedAt: T0,
        nextAttemptAt: null,
        attempts: 1,
      }),
    ).rejects.toThrow();
  });
});

describe('the queue is the ONLY way out (R-14)', () => {
  it('a delivered entry is removed, and the count drops', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('DELIVERED'));
    expect(await queue.countUnlanded()).toBe(1);

    await queue.remove(IdempotencyKey.of(keyFor('DELIVERED')));

    expect(await queue.countUnlanded()).toBe(0);
    expect(
      await queue.findByPostingId(IdempotencyKey.of(keyFor('DELIVERED'))),
    ).toBeNull();
  });

  it('the PRIMARY KEY refuses a second entry for one weighing', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('ONCE'));

    // Two entries for one weighing would be two deliveries.
    await expect(queue.enqueue(entryFor('ONCE'))).rejects.toThrow();
  });

  it('the count is the number of entries that have not landed (R-04)', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);

    await queue.enqueue(entryFor('ONE'));
    await queue.enqueue(entryFor('TWO'));
    await queue.enqueue(entryFor('THREE'));

    expect(await queue.countUnlanded()).toBe(3);

    await queue.remove(IdempotencyKey.of(keyFor('TWO')));

    expect(await queue.countUnlanded()).toBe(2);
  });
});
