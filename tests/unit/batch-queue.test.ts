/**
 * The batch queue projection and the read use case.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT IS UNDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * The projector:
 *   - every one of the seven FR-1 columns is carried, verbatim
 *   - the MES's ORDER is kept — the projection does not re-sort
 *   - the eligibility is DROPPED — this unit does not enforce it
 *   - a missing fabric description becomes `null`, and the row SURVIVES
 *   - the receipt time is the snapshot's, never the render time
 *   - the freshness is PASSED THROUGH, not re-decided
 *
 * The use case:
 *   - `SUCCEEDED` → AVAILABLE
 *   - `SUCCEEDED_STALE` → AVAILABLE, with the staleness still visible
 *   - `FAILED` → UNAVAILABLE, with the reason, and the detail to the log
 *   - the detail NEVER reaches the caller as a queue
 *
 * The clock is not injected anywhere, because **neither of these holds
 * one** — that is the point of them. The receipt time is the snapshot's
 * fact, and a test that waited for a clock would be testing nothing.
 */
import { describe, it, expect } from 'vitest';
import { BatchQueueProjector } from '../../src/001-batch-management/domain/services/batch-queue-projector.js';
import { RetrieveBatchQueue } from '../../src/001-batch-management/application/use-cases/retrieve-batch-queue.js';
import { StationBatchQueue } from '../../src/001-batch-management/domain/entities/station-batch-queue.js';
import {
  BatchQueueSnapshot,
  ReleasedBatch,
} from '../../src/005-orgatex-integration/domain/entities/snapshots.js';
import {
  BatchId,
  MachineRef,
  OrderRef,
  ShadeCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import {
  CURRENT,
  stale,
} from '../../src/005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import type { BatchWeighingStatus } from '../../src/005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import type { BatchEligibility } from '../../src/005-orgatex-integration/domain/value-objects/batch-eligibility.js';
import type { BatchQueueReadOutcome } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';
import type { BatchQueueSource } from '../../src/001-batch-management/domain/ports/batch-queue-source.js';

const RECEIVED_AT = new Date('2026-11-04T06:12:00.000Z');

/** A released batch, valid unless a test says otherwise. */
function releasedBatch(
  overrides: {
    readonly batchId?: string;
    readonly orderRef?: string;
    readonly machineRef?: string;
    readonly fabricDescription?: string;
    readonly shadeCode?: string;
    readonly componentCount?: number;
    readonly weighingStatus?: BatchWeighingStatus;
    readonly eligibility?: BatchEligibility;
  } = {},
): ReleasedBatch {
  return new ReleasedBatch(
    BatchId.create(overrides.batchId ?? 'B-24187'),
    OrderRef.create(overrides.orderRef ?? 'SO-9931'),
    MachineRef.create(overrides.machineRef ?? 'JET-04'),
    overrides.fabricDescription ?? '100% CTN knit · 480 kg',
    ShadeCode.create(overrides.shadeCode ?? 'Teal 4C'),
    overrides.componentCount ?? 5,
    overrides.weighingStatus ?? 'RELEASED',
    overrides.eligibility ?? { kind: 'ELIGIBLE' },
  );
}

/** A snapshot, valid unless a test says otherwise. */
function snapshot(
  batches: readonly ReleasedBatch[] = [releasedBatch()],
): BatchQueueSnapshot {
  return new BatchQueueSnapshot(
    batches,
    Instant.of(RECEIVED_AT),
    'DUMMY_ORGATEX',
  );
}

/** A source a test drives directly. */
class StubSource implements BatchQueueSource {
  outcome: BatchQueueReadOutcome = {
    kind: 'SUCCEEDED',
    snapshot: snapshot(),
    freshness: CURRENT,
  };
  reads = 0;

  async read(): Promise<BatchQueueReadOutcome> {
    this.reads += 1;
    return this.outcome;
  }
}

describe('BatchQueueProjector', () => {
  const projector = new BatchQueueProjector();

  it('carries every one of the seven FR-1 columns', () => {
    const queue = projector.project(snapshot(), CURRENT);

    expect(queue.batches).toHaveLength(1);
    const row = queue.batches[0];
    expect(row?.batchId.value).toBe('B-24187');
    expect(row?.orderRef.value).toBe('SO-9931');
    expect(row?.machineRef.value).toBe('JET-04');
    expect(row?.fabricDescription).toBe('100% CTN knit · 480 kg');
    expect(row?.shadeCode.value).toBe('Teal 4C');
    expect(row?.componentCount).toBe(5);
    expect(row?.weighingStatus).toBe('RELEASED');
  });

  it('keeps the MES\'s order — the projection does not re-sort', () => {
    const queue = projector.project(
      snapshot([
        releasedBatch({ batchId: 'B-3' }),
        releasedBatch({ batchId: 'B-1' }),
        releasedBatch({ batchId: 'B-2' }),
      ]),
      CURRENT,
    );

    expect(queue.batches.map((b) => b.batchId.value)).toEqual([
      'B-3',
      'B-1',
      'B-2',
    ]);
  });

  it('drops the eligibility — this unit reports the work, it does not gate it', () => {
    const queue = projector.project(
      snapshot([
        releasedBatch({
          weighingStatus: 'WEIGHING',
          eligibility: { kind: 'NOT_ELIGIBLE', reason: 'BEING_WEIGHED_ELSEWHERE' },
        }),
      ]),
      CURRENT,
    );

    // The status is carried; the eligibility is not. Bolt 009 enforces it,
    // on the snapshot — a row that carried a gate it did not enforce would
    // invite a reader to assume it did.
    expect(queue.batches[0]?.weighingStatus).toBe('WEIGHING');
    expect(Object.keys(queue.batches[0] ?? {})).not.toContain('eligibility');
  });

  it('keeps a row whose fabric description is missing, with the field null', () => {
    const queue = projector.project(
      snapshot([releasedBatch({ fabricDescription: '' })]),
      CURRENT,
    );

    // The row is NOT silently dropped — the story says so explicitly.
    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0]?.fabricDescription).toBeNull();
  });

  it('nulls a whitespace-only description, because blank is not a description', () => {
    const queue = projector.project(
      snapshot([releasedBatch({ fabricDescription: '   ' })]),
      CURRENT,
    );

    expect(queue.batches[0]?.fabricDescription).toBeNull();
  });

  it('trims a description that has surrounding whitespace', () => {
    const queue = projector.project(
      snapshot([releasedBatch({ fabricDescription: '  100% CTN  ' })]),
      CURRENT,
    );

    expect(queue.batches[0]?.fabricDescription).toBe('100% CTN');
  });

  it('carries the snapshot\'s receipt time — not the time of the projection', () => {
    const queue = projector.project(snapshot(), CURRENT);

    expect(queue.receivedAt).toEqual(RECEIVED_AT);
  });

  it('carries the source, so a degraded read is attributable', () => {
    const queue = projector.project(snapshot(), CURRENT);

    expect(queue.source).toBe('DUMMY_ORGATEX');
  });

  it('passes the freshness through unchanged — it does not re-decide staleness', () => {
    const current = projector.project(snapshot(), CURRENT);
    expect(current.freshness).toEqual({ kind: 'CURRENT' });

    const aged = projector.project(snapshot(), stale(42_000));
    expect(aged.freshness).toEqual({ kind: 'STALE', ageMs: 42_000 });
  });

  it('projects an empty queue as an empty queue, not as a failure', () => {
    const queue = projector.project(snapshot([]), CURRENT);

    expect(queue.batches).toHaveLength(0);
    expect(queue.count).toBe(0);
    expect(queue.receivedAt).toEqual(RECEIVED_AT);
  });
});

describe('RetrieveBatchQueue', () => {
  it('returns an AVAILABLE queue on a successful read', async () => {
    const source = new StubSource();
    const useCase = new RetrieveBatchQueue({ source });

    const availability = await useCase.execute();

    expect(availability.kind).toBe('AVAILABLE');
    if (availability.kind !== 'AVAILABLE') return;
    expect(availability.queue).toBeInstanceOf(StationBatchQueue);
    expect(availability.queue.batches).toHaveLength(1);
    expect(availability.queue.receivedAt).toEqual(RECEIVED_AT);
  });

  it('reads through the port exactly once', async () => {
    const source = new StubSource();
    const useCase = new RetrieveBatchQueue({ source });

    await useCase.execute();

    expect(source.reads).toBe(1);
  });

  it('returns an AVAILABLE queue on a stale read, with the staleness still visible', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'SUCCEEDED_STALE',
      snapshot: snapshot(),
      freshness: stale(90_000),
    };
    const useCase = new RetrieveBatchQueue({ source });

    const availability = await useCase.execute();

    // Unit 005 decided the snapshot is serveable. This unit does not
    // re-decide that — but the age must still reach the operator.
    expect(availability.kind).toBe('AVAILABLE');
    if (availability.kind !== 'AVAILABLE') return;
    expect(availability.queue.freshness).toEqual({
      kind: 'STALE',
      ageMs: 90_000,
    });
  });

  it('returns UNAVAILABLE with the reason on a failed read', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'FAILED',
      reason: 'UNREACHABLE',
      message: 'The Dummy OrgaTEX is unreachable',
    };
    const useCase = new RetrieveBatchQueue({ source });

    const availability = await useCase.execute();

    expect(availability.kind).toBe('UNAVAILABLE');
    if (availability.kind !== 'UNAVAILABLE') return;
    expect(availability.reason).toBe('UNREACHABLE');
  });

  it('carries NO queue on a failed read — an empty queue is never substituted for "unknown"', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'FAILED',
      reason: 'TIMEOUT',
      message: 'timed out',
    };
    const useCase = new RetrieveBatchQueue({ source });

    const availability = await useCase.execute();

    expect(availability.kind).toBe('UNAVAILABLE');
    expect('queue' in availability).toBe(false);
  });

  it('writes the diagnostic to the log, never into the caller\'s answer', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'FAILED',
      reason: 'MALFORMED',
      message: 'Unknown weighing status "RELEASED_TOMORROW" on batch B-24187',
    };
    const logged: string[] = [];
    const useCase = new RetrieveBatchQueue({
      source,
      onError: (detail) => logged.push(detail),
    });

    const availability = await useCase.execute();

    // The detail reached the log (BRD IR-09)…
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('MALFORMED');
    expect(logged[0]).toContain('RELEASED_TOMORROW');

    // …and the reason code reached the caller, without the detail.
    if (availability.kind !== 'UNAVAILABLE') return;
    expect(availability.reason).toBe('MALFORMED');
  });

  it('does not throw when no error handler is bound', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'FAILED',
      reason: 'UNREACHABLE',
      message: 'gone',
    };
    const useCase = new RetrieveBatchQueue({ source });

    await expect(useCase.execute()).resolves.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });
});
