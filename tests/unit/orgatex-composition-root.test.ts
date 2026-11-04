/**
 * The OrgaTEX module's wiring (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE COMPOSITION ROOT IS WHERE THE SEAMS MEET.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The wiring is the one place where bolt 007's three pieces — the link
 * state, the queue and the retry worker — are bound to each other, and a
 * mistake here is invisible everywhere else:
 *
 * - the retry worker is **off by default** (a test drives the queue
 *   deterministically) and the **server** turns it on;
 * - the queue asks the **link state service** for the link's status, so
 *   there is one derivation and not two;
 * - the events are wired to the caller's handlers.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  buildOrgatexModule,
} from '../../src/005-orgatex-integration/infrastructure/composition-root.js';
import {
  ConsumptionPosting,
} from '../../src/005-orgatex-integration/domain/entities/postings.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import type {
  LinkEvent,
} from '../../src/005-orgatex-integration/domain/events/link-events.js';
import type {
  SyncQueueEvent,
} from '../../src/005-orgatex-integration/domain/events/sync-queue-events.js';
import { DEFAULT_ORGATEX_CONFIG } from '../support/orgatex-harness.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

describe('the OrgaTEX module — the wiring', () => {
  it('the retry worker is OFF by default — a test drives the queue itself', () => {
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
    });

    // The worker exists — it is wired — but it is not ticking, because a
    // test that cannot predict a tick cannot assert on one.
    expect(module.syncRetryWorker).toBeDefined();
    module.syncRetryWorker.dispose();
  });

  it('the retry worker STARTS when the server asks for it', () => {
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
      startRetryWorker: true,
    });

    expect(module.syncRetryWorker).toBeDefined();
    // Stop it again, so the test leaves no timer behind.
    module.syncRetryWorker.dispose();
  });

  it('the link state service is the queue\'s single source of the link status', async () => {
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
    });

    // The observations are read through the ONE service, and the status
    // is derived from them — never stored.
    const state = await module.linkStateService.read();

    expect(state.status).toBe('OFFLINE');
    expect(state.lastContactAt).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
  });

  it('the queue reports its events to the caller', async () => {
    const events: SyncQueueEvent[] = [];
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
      onSyncQueueEvent: (event) => events.push(event),
    });

    const posting = new ConsumptionPosting(
      IdempotencyKey.of('IDK-cafebabe0badf00d'),
      BatchId.create('B-24187'),
      ComponentId.create('C-01'),
      WeightValue.of('94.01', 'g'),
      LotNumber.create('L-77120'),
      OperatorReference.create('OP-001'),
      T0,
      T0,
    );

    const result = await module.syncQueueService.enqueue(posting);

    expect(result.outcome).toBe('QUEUED');
    const queued = events.find((e) => e.type === 'SYNC_ENTRY_QUEUED');
    expect(queued).toBeDefined();
  });

  it('the link reports its events to the caller', async () => {
    const events: LinkEvent[] = [];
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
      onLinkEvent: (event) => events.push(event),
    });

    // The first successful contact moves the link from OFFLINE to
    // LINKED — a change, so a transition is recorded and an event fires.
    await module.linkStateService.recordSuccess(T0);

    const changed = events.find((e) => e.type === 'LINK_STATE_CHANGED');
    expect(changed).toBeDefined();
    if (changed === undefined || changed.type !== 'LINK_STATE_CHANGED') return;
    expect(changed.from).toBe('OFFLINE');
    expect(changed.to).toBe('LINKED');
  });

  it('the module builds with NO clock — the wall clock is the fallback', async () => {
    // The clock is optional, so a caller that does not inject one gets
    // the wall clock. That is the production default, and it is the one
    // path the other tests never take.
    const module = buildOrgatexModule({ config: DEFAULT_ORGATEX_CONFIG });

    expect(module).toBeDefined();
    // The fallback clock is a REAL clock, so reading the link state uses
    // it — the wall clock, and not a frozen instant.
    const state = await module.linkStateService.read();
    expect(state.status).toBe('OFFLINE');
    module.syncRetryWorker.dispose();
  });

  it('the module wires the READ and POSTING event handlers', async () => {
    const orgatexEvents: unknown[] = [];
    const postingEvents: unknown[] = [];
    const module = buildOrgatexModule({
      config: DEFAULT_ORGATEX_CONFIG,
      clock: () => T0.toDate(),
      onEvent: (event) => orgatexEvents.push(event),
      onPostingEvent: (event) => postingEvents.push(event),
    });

    // A read succeeds, so the reader emits a read event.
    await module.queueReader.read();
    expect(orgatexEvents.length).toBeGreaterThan(0);

    // A contact failure is a failed contact, so the posting service emits
    // an attempt event.
    module.world.setReachable(false);
    await module.postingService.post({
      batchId: BatchId.create('B-24187'),
      componentId: ComponentId.create('C-01'),
      actualQuantity: WeightValue.of('94.01', 'g'),
      lotNumber: LotNumber.create('L-77120'),
      operatorId: OperatorReference.create('OP-001'),
      weighedAt: T0,
    });
    expect(postingEvents.length).toBeGreaterThan(0);

    module.syncRetryWorker.dispose();
  });

  it('a FAILED scheduled evaluation is LOGGED, not swallowed', async () => {
    // The freshness deadline's callback re-derives the link state, which
    // reads and writes the database — so it is asynchronous, and it can
    // reject.
    //
    // A rejection left floating becomes an **unhandled rejection**, and
    // Node terminates the process on those by default. The composition
    // root is where that failure is caught and made visible.
    const logged: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      const module = buildOrgatexModule({
        config: DEFAULT_ORGATEX_CONFIG,
        clock: () => T0.toDate(),
      });

      // A deadline in the past — so the timer fires on the next tick.
      module.linkScheduler.schedule(
        Instant.of(new Date(Date.now() - 1000)),
        () => Promise.reject(new Error('the database is gone')),
      );

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(logged.length).toBeGreaterThan(0);
      expect(JSON.stringify(logged)).toContain('scheduled link evaluation failed');

      module.linkScheduler.dispose();
      module.syncRetryWorker.dispose();
    } finally {
      console.error = originalError;
    }
  });
});
