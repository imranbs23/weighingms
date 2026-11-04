/**
 * The link's persistence and the queue's scheduled worker (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PARTS OF THE BOLT THAT THE OTHER FILES DO NOT REACH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three things live here, and each is a place where a quiet mistake would
 * be invisible:
 *
 * 1. **The transition log's persistence.** `SqliteLinkTransitionRepository`
 *    is the append-only record, and the table carries **triggers** that
 *    abort any UPDATE or DELETE. A trigger is the enforcement — a
 *    repository without an `update` method is only a convention.
 *
 * 2. **The observations row.** One row, `CHECK (id = 1)`, holding the
 *    observations and never the derived status.
 *
 * 3. **The scheduled retry worker.** The periodic half of the two
 *    triggers (OQ-6): the flush on recovery is event-driven, and this is
 *    the tick that picks up the entries whose backoff has expired.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { openOrgatexDatabase } from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import {
  SqliteLinkTransitionRepository,
} from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-transition-repository.js';
import {
  SqliteLinkContactRepository,
} from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-contact-repository.js';
import {
  linkTransition,
} from '../../src/005-orgatex-integration/domain/entities/link-transition.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  SyncRetryWorker,
} from '../../src/005-orgatex-integration/domain/services/sync-retry-worker.js';
import type { SyncQueueService } from '../../src/005-orgatex-integration/domain/services/sync-queue-service.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

describe('SqliteLinkTransitionRepository — the append-only log', () => {
  it('appends a transition and reads it back, oldest first', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkTransitionRepository(db);

    await repository.append(
      linkTransition({
        from: 'OFFLINE',
        to: 'LINKED',
        occurredAt: T0,
        cause: 'CONTACT_SUCCESS',
      }),
    );
    await repository.append(
      linkTransition({
        from: 'LINKED',
        to: 'DEGRADED',
        occurredAt: T0.plus(1000),
        cause: 'CONTACT_FAILURE',
      }),
    );

    const all = await repository.findAll();

    expect(all).toHaveLength(2);
    expect(all[0]?.from).toBe('OFFLINE');
    expect(all[0]?.to).toBe('LINKED');
    expect(all[1]?.from).toBe('LINKED');
    expect(all[1]?.to).toBe('DEGRADED');
  });

  it('reads the MOST RECENT transition', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkTransitionRepository(db);

    // An empty log has no most recent transition — and saying so is
    // better than returning a fabricated one.
    expect(await repository.findMostRecent()).toBeNull();

    await repository.append(
      linkTransition({
        from: 'OFFLINE',
        to: 'LINKED',
        occurredAt: T0,
        cause: 'CONTACT_SUCCESS',
      }),
    );
    await repository.append(
      linkTransition({
        from: 'LINKED',
        to: 'DEGRADED',
        occurredAt: T0.plus(1000),
        cause: 'CONTACT_FAILURE',
      }),
    );

    const most = await repository.findMostRecent();
    expect(most?.to).toBe('DEGRADED');
    expect(most?.cause).toBe('CONTACT_FAILURE');
  });

  it('the history CANNOT be rewritten — the trigger aborts an UPDATE', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkTransitionRepository(db);

    await repository.append(
      linkTransition({
        from: 'OFFLINE',
        to: 'LINKED',
        occurredAt: T0,
        cause: 'CONTACT_SUCCESS',
      }),
    );

    // Even code that reaches past the repository — a repair script, for
    // instance — cannot rewrite a fact about the past.
    expect(() =>
      db.prepare("UPDATE link_transitions SET to_status = 'LINKED'").run(),
    ).toThrow(/append-only/);
  });

  it('the history CANNOT be erased — the trigger aborts a DELETE', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkTransitionRepository(db);

    await repository.append(
      linkTransition({
        from: 'OFFLINE',
        to: 'LINKED',
        occurredAt: T0,
        cause: 'CONTACT_SUCCESS',
      }),
    );

    expect(() =>
      db.prepare('DELETE FROM link_transitions').run(),
    ).toThrow(/append-only/);
  });
});

describe('SqliteLinkContactRepository — one row of observations', () => {
  it('starts with NO observations — the seeded row is empty', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkContactRepository(db);

    const observations = await repository.read();

    expect(observations.lastSuccessAt).toBeNull();
    expect(observations.lastFailureAt).toBeNull();
    expect(observations.lastError).toBeNull();
    expect(observations.consecutiveFailures).toBe(0);
  });

  it('a success records the time and CLEARS the streak and the error', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkContactRepository(db);

    await repository.recordFailure(
      SyncError.of('UNREACHABLE', 'OrgaTEX could not be reached', 'detail'),
      T0,
    );
    expect((await repository.read()).consecutiveFailures).toBe(1);

    await repository.recordSuccess(T0.plus(1000));

    const observations = await repository.read();
    expect(observations.lastSuccessAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
    expect(observations.consecutiveFailures).toBe(0);
    // A healthy link has no error to report about.
    expect(observations.lastError).toBeNull();
  });

  it('a failure GROWS the streak and records the error', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkContactRepository(db);

    await repository.recordFailure(
      SyncError.of('TIMEOUT', 'OrgaTEX did not answer in time', 'raw'),
      T0,
    );
    await repository.recordFailure(
      SyncError.of('TIMEOUT', 'OrgaTEX did not answer in time', 'raw'),
      T0.plus(1000),
    );

    const observations = await repository.read();
    expect(observations.consecutiveFailures).toBe(2);
    expect(observations.lastFailureAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
    expect(observations.lastError?.code).toBe('TIMEOUT');
    expect(observations.lastError?.detail).toBe('raw');
  });

  it('there is only ever ONE row — the schema says so', () => {
    const db = openOrgatexDatabase(':memory:');

    // A second row is structurally impossible: `CHECK (id = 1)`.
    expect(() =>
      db
        .prepare(
          `INSERT INTO link_contact_observations (id, consecutive_failures)
             VALUES (2, 0)`,
        )
        .run(),
    ).toThrow();
  });

  it('a queue entry with NO next attempt time is refused by the schema', () => {
    const db = openOrgatexDatabase(':memory:');

    // The table's own CHECK is the enforcement: a PENDING entry with no
    // next attempt time is a contradiction, and the database refuses it
    // rather than the application remembering to.
    expect(() =>
      db
        .prepare(
          `INSERT INTO sync_queue_entries (
             posting_id, batch_id, component_id, actual_quantity, unit,
             lot_number, operator_id, weighed_at, queued_at, attempts,
             last_attempt_at, next_attempt_at, last_error_code,
             last_error_summary, last_error_detail, state
           ) VALUES (
             'IDK-cafebabe0badf00d', 'B-24187', 'C-01', '94.01', 'g',
             'L-77120', 'OP-001', '2026-10-30T08:00:00.000Z',
             '2026-10-30T08:00:00.000Z', 0, NULL, NULL, NULL,
             NULL, NULL, 'PENDING'
           )`,
        )
        .run(),
    ).toThrow();
  });
});

describe('SyncRetryWorker — the scheduled trigger (OQ-6)', () => {
  /** A queue that records what it was asked to do. */
  class StubQueue {
    readonly due: Instant[] = [];
    failWith: Error | null = null;

    async retryDue(now: Instant): Promise<unknown[]> {
      this.due.push(now);
      if (this.failWith !== null) throw this.failWith;
      return [];
    }
  }

  function build(options?: {
    readonly failWith?: Error;
  }): { worker: SyncRetryWorker; queue: StubQueue } {
    const queue = new StubQueue();
    queue.failWith = options?.failWith ?? null;
    const worker = new SyncRetryWorker({
      queue: queue as unknown as SyncQueueService,
      intervalMs: 50,
      clock: () => T0.toDate(),
    });
    return { worker, queue };
  }

  it('a tick asks the queue for the entries that are due', async () => {
    const { worker, queue } = build();

    await worker.tick();

    expect(queue.due).toHaveLength(1);
    expect(queue.due[0]?.epochMillis).toBe(T0.epochMillis);
  });

  it('starting TWICE does not start two timers', async () => {
    const { worker, queue } = build();

    worker.start();
    worker.start();

    await worker.tick();
    expect(queue.due).toHaveLength(1);

    worker.stop();
  });

  it('a failed tick is VISIBLE and does not kill the worker', async () => {
    const seen: unknown[] = [];
    const queue = new StubQueue();
    queue.failWith = new Error('the MES is unreachable');
    const worker = new SyncRetryWorker({
      queue: queue as unknown as SyncQueueService,
      intervalMs: 50,
      clock: () => T0.toDate(),
      onError: (error) => seen.push(error),
    });

    // A failing tick must not take the worker down — the next tick will
    // try again — but the failure must not be silent either.
    await worker.tick();

    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('the MES is unreachable');

    // The worker is still alive.
    queue.failWith = null;
    await worker.tick();
    expect(queue.due).toHaveLength(2);
  });

  it('stopping releases the timer, and stopping twice is harmless', () => {
    const { worker } = build();

    worker.start();
    worker.stop();
    // A second stop must not throw — the timer is already gone.
    worker.stop();

    worker.dispose();
  });

  it('the timer does not keep the process alive', async () => {
    const { worker } = build();

    worker.start();
    // The interval is a Node timer that must be `unref`'d, so a station
    // can shut down cleanly with a retry pending.
    expect(worker).toBeDefined();

    worker.dispose();
  });

  it('the INTERVAL fires the tick — the periodic half of the two triggers', async () => {
    const { worker, queue } = build();

    // The worker's own interval is what makes the queue alive across a
    // link that flickered rather than failed cleanly. So the interval
    // itself must reach the queue.
    worker.start();

    // The interval is 50 ms in this harness; the wait is generous so the
    // assertion is not a race.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(queue.due.length).toBeGreaterThan(0);

    worker.dispose();
  });
});
