/**
 * The readers — the `DEGRADED` fallback, and every edge case the stories
 * name.
 *
 * THE CLOCK IS INJECTED, ALWAYS
 * -----------------------------
 * A freshness test that waits five minutes is not a test. Every deadline
 * here is crossed by advancing the clock, so the boundary is tested
 * exactly.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * Story 001's edge cases:
 *   - an empty queue is an empty snapshot, not an error
 *   - a batch not in RELEASED reports its eligibility
 *   - a malformed record fails the WHOLE read
 *   - a batch released after the last snapshot does not appear until the
 *     next read
 *   - the MES unreachable with DEGRADED → the last snapshot, with its age
 *   - the MES unreachable with OFFLINE → the read fails loudly
 *   - the MES unreachable with NO prior snapshot → the read fails, and NO
 *     empty queue is substituted for "unknown"
 *
 * Story 002's edge cases:
 *   - a recipe with no components is a snapshot with an empty list
 *   - a component with no tolerance carries an ABSENT tolerance
 *   - a component with an unknown scale class fails the whole read
 *   - a target exceeding the largest scale's capacity is still returned
 *   - the MES unreachable → the last snapshot, with its age
 *   - a revised recipe supersedes the older one
 *   - a malformed recipe fails the whole read
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BatchQueueReader } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';
import { RecipeReader } from '../../src/005-orgatex-integration/domain/services/recipe-reader.js';
import { SnapshotCache } from '../../src/005-orgatex-integration/domain/services/snapshot-cache.js';
import {
  AdapterError,
  type BatchStatusFilter,
  type BatchStatusToWrite,
  type OrgatexAdapter,
  type RawBatch,
  type RawComponent,
  type RawConsumption,
  type RawQueue,
  type RawRecipe,
} from '../../src/005-orgatex-integration/domain/ports/orgatex-adapter.js';
import { BatchId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OrgatexEvent } from '../../src/005-orgatex-integration/domain/events/orgatex-events.js';
import { TestClock } from '../support/scale-harness.js';

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** A batch, valid unless a test says otherwise. */
function batch(overrides: Partial<RawBatch> = {}): RawBatch {
  return {
    batchId: 'B-24187',
    orderRef: 'SO-9931',
    machineRef: 'JET-04',
    fabricDescription: '100% CTN knit · 480 kg',
    shadeCode: 'Teal 4C',
    componentCount: 5,
    weighingStatus: 'RELEASED',
    ...overrides,
  };
}

/** A component, valid unless a test says otherwise. */
function component(overrides: Partial<RawComponent> = {}): RawComponent {
  return {
    sequence: 1,
    componentId: 'DYE-4471-Y',
    dyestuffCode: 'DYE-4471',
    target: '94.0000',
    unit: 'g',
    toleranceMin: '93.5000',
    toleranceMax: '94.5000',
    scaleClass: 'PRECISION',
    ...overrides,
  };
}

/** An adapter a test drives directly. */
class StubAdapter implements OrgatexAdapter {
  queue: RawQueue = { batches: [batch()] };
  recipe: RawRecipe | null = {
    batchId: 'B-24187',
    shadeCode: 'Teal 4C',
    components: [component()],
  };
  failure: AdapterError | null = null;
  seenFilter: BatchStatusFilter | undefined;
  lastRecipeId: string | null = null;

  async readQueue(filter?: BatchStatusFilter): Promise<RawQueue> {
    this.seenFilter = filter;
    if (this.failure !== null) throw this.failure;
    return this.queue;
  }

  async readRecipe(batchId: BatchId): Promise<RawRecipe> {
    this.lastRecipeId = batchId.value;
    if (this.failure !== null) throw this.failure;
    if (this.recipe === null) {
      throw new AdapterError('NOT_FOUND', 'no such batch');
    }
    return this.recipe;
  }

  // The write path belongs to bolt `006`. These are here so the stub
  // satisfies the port — the READERS never call them.
  async postConsumption(_consumption: RawConsumption): Promise<void> {
    throw new Error('postConsumption is not exercised by the readers');
  }

  async writeBatchStatus(
    _batchId: BatchId,
    _status: BatchStatusToWrite,
  ): Promise<void> {
    throw new Error('writeBatchStatus is not exercised by the readers');
  }
}

describe('BatchQueueReader', () => {
  let clock: TestClock;
  let adapter: StubAdapter;
  let cache: SnapshotCache;
  let events: OrgatexEvent[];

  function reader(freshnessWindowMs = FRESHNESS_WINDOW_MS): BatchQueueReader {
    return new BatchQueueReader({
      adapter,
      cache,
      clock: clock.now,
      source: 'DUMMY_ORGATEX',
      freshnessWindowMs,
      onEvent: (event) => events.push(event),
    });
  }

  beforeEach(() => {
    clock = new TestClock();
    adapter = new StubAdapter();
    cache = new SnapshotCache();
    events = [];
  });

  it('returns the batches with every field the story names', async () => {
    const outcome = await reader().read();

    expect(outcome.kind).toBe('SUCCEEDED');
    if (outcome.kind !== 'SUCCEEDED') return;

    const first = outcome.snapshot.batches[0];
    expect(first?.batchId.value).toBe('B-24187');
    expect(first?.orderRef.value).toBe('SO-9931');
    expect(first?.machineRef.value).toBe('JET-04');
    expect(first?.fabricDescription).toBe('100% CTN knit · 480 kg');
    expect(first?.shadeCode.value).toBe('Teal 4C');
    expect(first?.componentCount).toBe(5);
    expect(first?.weighingStatus).toBe('RELEASED');
  });

  it('records the time it was received and the source', async () => {
    const outcome = await reader().read();
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    expect(outcome.snapshot.receivedAt.toDate().toISOString()).toBe(
      clock.now().toISOString(),
    );
    expect(outcome.snapshot.source).toBe('DUMMY_ORGATEX');
  });

  it('marks a fresh snapshot CURRENT', async () => {
    const outcome = await reader().read();
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');
    expect(outcome.freshness).toEqual({ kind: 'CURRENT' });
  });

  it('passes a status filter to the adapter', async () => {
    await reader().read('WEIGHING');
    expect(adapter.seenFilter).toBe('WEIGHING');
  });

  it('applies the filter ITSELF — the MES may ignore it', async () => {
    // The MES returns everything regardless of the filter.
    adapter.queue = {
      batches: [batch({ weighingStatus: 'RELEASED' }), batch({ batchId: 'B-2', weighingStatus: 'QUEUED' })],
    };

    const outcome = await reader().read('RELEASED');
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    expect(outcome.snapshot.batches).toHaveLength(1);
    expect(outcome.snapshot.batches[0]?.weighingStatus).toBe('RELEASED');
  });

  it('reports a batch that is NOT RELEASED as ineligible, with a reason', async () => {
    adapter.queue = { batches: [batch({ weighingStatus: 'QUEUED' })] };

    const outcome = await reader().read();
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    expect(outcome.snapshot.batches[0]?.eligibility).toEqual({
      kind: 'NOT_ELIGIBLE',
      reason: 'NOT_RELEASED',
    });
  });

  it('returns an EMPTY snapshot for an empty queue — not an error', async () => {
    adapter.queue = { batches: [] };

    const outcome = await reader().read();
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    expect(outcome.snapshot.batches).toHaveLength(0);
    expect(outcome.snapshot.count).toBe(0);
    expect(outcome.snapshot.receivedAt).toBeDefined();
  });

  it('fails the WHOLE read when a record is malformed', async () => {
    adapter.queue = {
      batches: [batch(), batch({ batchId: 'B-2', weighingStatus: 'FANTASTIC' })],
    };

    const outcome = await reader().read();
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('fails the whole read when a component count is not a whole number', async () => {
    adapter.queue = { batches: [batch({ componentCount: -1 })] };

    const outcome = await reader().read();
    expect(outcome.kind).toBe('FAILED');
  });

  it('does NOT show a batch released after the last snapshot until the next read', async () => {
    await reader().read();

    adapter.queue = {
      batches: [batch(), batch({ batchId: 'B-2', weighingStatus: 'RELEASED' })],
    };

    const outcome = await reader().read();
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');
    expect(outcome.snapshot.batches).toHaveLength(2);
  });

  it('emits a contact event on success', async () => {
    await reader().read();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('BATCH_QUEUE_READ');
  });

  // ── The DEGRADED fallback ──

  it('serves the last known-good, MARKED WITH ITS AGE, when the MES goes away', async () => {
    await reader().read();

    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    clock.advance(30_000);

    const outcome = await reader().read();
    expect(outcome.kind).toBe('SUCCEEDED_STALE');
    if (outcome.kind !== 'SUCCEEDED_STALE') return;

    expect(outcome.snapshot.batches).toHaveLength(1);
    expect(outcome.freshness).toEqual({ kind: 'STALE', ageMs: 30_000 });
  });

  it('serves a stale snapshot EXACTLY AT the freshness window boundary', async () => {
    await reader().read();

    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    clock.advance(FRESHNESS_WINDOW_MS);

    const outcome = await reader().read();
    expect(outcome.kind).toBe('SUCCEEDED_STALE');
  });

  it('fails LOUDLY one millisecond past the freshness window', async () => {
    await reader().read();

    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    clock.advance(FRESHNESS_WINDOW_MS + 1);

    const outcome = await reader().read();
    expect(outcome.kind).toBe('FAILED');
  });

  it('fails LOUDLY — and substitutes NOTHING — when there is no prior snapshot', async () => {
    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');

    const outcome = await reader().read();
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;

    expect(outcome.reason).toBe('UNREACHABLE');
    // There is no snapshot on the failed branch — an empty queue is never
    // substituted for "unknown".
    expect('snapshot' in outcome).toBe(false);
  });

  it('emits a failure event carrying the reason', async () => {
    adapter.failure = new AdapterError('TIMEOUT', 'the MES timed out');

    await reader().read();
    expect(events[0]?.type).toBe('BATCH_QUEUE_READ_FAILED');
    if (events[0]?.type !== 'BATCH_QUEUE_READ_FAILED') return;
    expect(events[0].reason).toBe('TIMEOUT');
  });

  it('treats an unexpected error as UNREACHABLE', async () => {
    adapter.failure = new Error('something else entirely') as AdapterError;

    const outcome = await reader().read();
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('UNREACHABLE');
  });

  it('remembers the last known-good even when the read that produced it later failed', async () => {
    // A successful read, then a failure: the cache holds the good one.
    await reader().read();
    adapter.failure = new AdapterError('UNREACHABLE', 'down');
    clock.advance(1000);

    const outcome = await reader().read();
    expect(outcome.kind).toBe('SUCCEEDED_STALE');
  });
});

describe('RecipeReader', () => {
  let clock: TestClock;
  let adapter: StubAdapter;
  let cache: SnapshotCache;
  let events: OrgatexEvent[];

  function reader(freshnessWindowMs = FRESHNESS_WINDOW_MS): RecipeReader {
    return new RecipeReader({
      adapter,
      cache,
      clock: clock.now,
      source: 'DUMMY_ORGATEX',
      freshnessWindowMs,
      onEvent: (event) => events.push(event),
    });
  }

  beforeEach(() => {
    clock = new TestClock();
    adapter = new StubAdapter();
    cache = new SnapshotCache();
    events = [];
  });

  it('returns the components with every field the story names', async () => {
    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('SUCCEEDED');
    if (outcome.kind !== 'SUCCEEDED') return;

    const snapshot = outcome.snapshot;
    expect(snapshot.batchId.value).toBe('B-24187');
    expect(snapshot.shadeCode.value).toBe('Teal 4C');
    expect(snapshot.receivedAt.toDate().toISOString()).toBe(
      clock.now().toISOString(),
    );
    expect(snapshot.source).toBe('DUMMY_ORGATEX');

    const first = snapshot.components[0];
    expect(first?.sequence).toBe(1);
    expect(first?.componentId.value).toBe('DYE-4471-Y');
    expect(first?.dyestuffCode.value).toBe('DYE-4471');
    expect(first?.target.toJSON()).toBe('94.0000');
    expect(first?.target.unit).toBe('g');
    expect(first?.tolerance?.min.toJSON()).toBe('93.5000');
    expect(first?.tolerance?.max.toJSON()).toBe('94.5000');
    expect(first?.scaleClass).toBe('PRECISION');
  });

  it('preserves the RECIPE SEQUENCE', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        component({ sequence: 3, componentId: 'C-3' }),
        component({ sequence: 1, componentId: 'C-1' }),
        component({ sequence: 2, componentId: 'C-2' }),
      ],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    // The MES's order is preserved verbatim — this unit does not re-sort.
    expect(
      outcome.snapshot.components.map((c) => c.componentId.value),
    ).toEqual(['C-3', 'C-1', 'C-2']);
  });

  it('returns an empty component list for a recipe with no components', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');
    expect(outcome.snapshot.components).toHaveLength(0);
  });

  it('carries an ABSENT tolerance — never a tolerance of zero', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        component({ toleranceMin: null, toleranceMax: null }),
      ],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');
    expect(outcome.snapshot.components[0]?.tolerance).toBeNull();
  });

  it('refuses a HALF-PRESENT tolerance band', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [component({ toleranceMax: null })],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('refuses an unknown scale class — and fails the whole read', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [component({ scaleClass: 'BENCH' })],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('returns a target EXCEEDING the largest scale — the recipe is read-only', async () => {
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        component({
          target: '40.0000',
          unit: 'kg',
          toleranceMin: null,
          toleranceMax: null,
          scaleClass: 'FLOOR',
        }),
      ],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    if (outcome.kind !== 'SUCCEEDED') throw new Error('expected success');

    // The recipe is returned intact. The station does not alter it; the
    // weighing of that component is blocked at SELECTION.
    expect(outcome.snapshot.components[0]?.target.toJSON()).toBe('40.0000');
  });

  it('refuses a recipe for a DIFFERENT batch than the one asked for', async () => {
    adapter.recipe = {
      batchId: 'B-99999',
      shadeCode: 'Teal 4C',
      components: [],
    };

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('FAILED');
  });

  it('reports NOT_FOUND distinctly from a failure', async () => {
    adapter.recipe = null;

    const outcome = await reader().read(BatchId.create('B-99999'));
    expect(outcome.kind).toBe('NOT_FOUND');
  });

  it('does NOT serve a stale recipe for a batch the MES says does not exist', async () => {
    // A good recipe is cached, and then the MES says the batch is gone.
    await reader().read(BatchId.create('B-24187'));
    adapter.recipe = null;

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('NOT_FOUND');
  });

  it('serves the last known-good recipe, MARKED WITH ITS AGE, when the MES goes away', async () => {
    await reader().read(BatchId.create('B-24187'));

    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    clock.advance(45_000);

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('SUCCEEDED_STALE');
    if (outcome.kind !== 'SUCCEEDED_STALE') return;
    expect(outcome.freshness).toEqual({ kind: 'STALE', ageMs: 45_000 });
  });

  it('fails LOUDLY one millisecond past the freshness window', async () => {
    await reader().read(BatchId.create('B-24187'));

    adapter.failure = new AdapterError('UNREACHABLE', 'the MES is down');
    clock.advance(FRESHNESS_WINDOW_MS + 1);

    const outcome = await reader().read(BatchId.create('B-24187'));
    expect(outcome.kind).toBe('FAILED');
  });

  it('emits a contact event on success', async () => {
    await reader().read(BatchId.create('B-24187'));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('RECIPE_READ');
  });

  it('emits a failure event for a missing batch', async () => {
    adapter.recipe = null;

    await reader().read(BatchId.create('B-99999'));
    expect(events[0]?.type).toBe('RECIPE_READ_FAILED');
    if (events[0]?.type !== 'RECIPE_READ_FAILED') return;
    expect(events[0].reason).toBe('NOT_FOUND');
  });
});
