/**
 * The batch filter and the batch selection.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT IS UNDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * The filter (a PURE function of a queue and a filter):
 *   - it keeps only the rows with the chosen status
 *   - it keeps the MES's ORDER among the rows it keeps
 *   - it keeps the receipt time, the source and the freshness UNCHANGED
 *   - it leaves the input queue untouched
 *   - "All" (a null filter) returns the whole queue
 *   - the offered statuses are the DISTINCT statuses of the queue, in the
 *     queue's order
 *
 * The selection use case:
 *   - a touch records TOUCH; a scan records SCAN — and NEITHER may be
 *     supplied by the caller
 *   - the eligibility is read from the SNAPSHOT, not from the projection
 *   - an ineligible batch is refused with the SPECIFIC reason
 *   - a refusal writes NOTHING
 *   - the filter is never a gate: the queue is read WITHOUT one
 *   - an unrecognised code is refused BEFORE eligibility is asked
 *   - the active selection is the newest one
 */
import { describe, it, expect } from 'vitest';
import { BatchQueueFilter } from '../../src/001-batch-management/domain/services/batch-queue-filter.js';
import { SelectBatch } from '../../src/001-batch-management/application/use-cases/select-batch.js';
import { BatchSelection } from '../../src/001-batch-management/domain/entities/batch-selection.js';
import type { BatchSelectionRepository } from '../../src/001-batch-management/domain/ports/batch-selection-repository.js';
import type {
  BatchScanner,
  ScanOutcome,
} from '../../src/001-batch-management/domain/ports/batch-scanner.js';
import type { BatchQueueSource } from '../../src/001-batch-management/domain/ports/batch-queue-source.js';
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
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import type { BatchWeighingStatus } from '../../src/005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import type { BatchEligibility } from '../../src/005-orgatex-integration/domain/value-objects/batch-eligibility.js';
import type { BatchQueueReadOutcome } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';

const RECEIVED_AT = new Date('2026-11-05T06:12:00.000Z');
const NOW = new Date('2026-11-05T06:14:22.000Z');

/** A released batch, valid unless a test says otherwise. */
function releasedBatch(
  overrides: {
    readonly batchId?: string;
    readonly orderRef?: string;
    readonly machineRef?: string;
    readonly weighingStatus?: BatchWeighingStatus;
    readonly eligibility?: BatchEligibility;
  } = {},
): ReleasedBatch {
  return new ReleasedBatch(
    BatchId.create(overrides.batchId ?? 'B-24187'),
    OrderRef.create(overrides.orderRef ?? 'SO-9931'),
    MachineRef.create(overrides.machineRef ?? 'JET-04'),
    '100% CTN knit · 480 kg',
    ShadeCode.create('Teal 4C'),
    5,
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
  /** The filters the use case passed, in order. */
  filters: (BatchWeighingStatus | undefined)[] = [];

  async read(filter?: BatchWeighingStatus): Promise<BatchQueueReadOutcome> {
    this.reads += 1;
    this.filters.push(filter);
    return this.outcome;
  }
}

/** A scanner a test drives directly. */
class StubScanner implements BatchScanner {
  outcome: ScanOutcome = { kind: 'NO_CODE', message: 'nothing was presented' };
  reads = 0;

  async read(): Promise<ScanOutcome> {
    this.reads += 1;
    return this.outcome;
  }
}

/** A repository that records what it was asked to save. */
class StubRepository implements BatchSelectionRepository {
  saved: BatchSelection[] = [];

  async save(selection: BatchSelection): Promise<void> {
    this.saved.push(selection);
  }

  async latest(): Promise<BatchSelection | null> {
    const last = this.saved[this.saved.length - 1];
    return last === undefined ? null : last;
  }
}

describe('BatchQueueFilter', () => {
  const filter = new BatchQueueFilter();

  /** A projected queue with three rows in three statuses. */
  const queue = {
    batches: [
      { weighingStatus: 'QUEUED' as BatchWeighingStatus },
      { weighingStatus: 'RELEASED' as BatchWeighingStatus },
      { weighingStatus: 'QUEUED' as BatchWeighingStatus },
    ],
    receivedAt: RECEIVED_AT,
    source: 'DUMMY_ORGATEX',
    freshness: CURRENT,
  };

  it('keeps only the rows with the chosen status', () => {
    const filtered = filter.filter(queue as never, 'QUEUED');

    expect(filtered.batches).toHaveLength(2);
    expect(
      filtered.batches.every((b) => b.weighingStatus === 'QUEUED'),
    ).toBe(true);
  });

  it('keeps the MES\'s order among the rows it keeps', () => {
    const filtered = filter.filter(queue as never, 'QUEUED');

    // The filter removes rows; it does not re-sort the survivors.
    expect(filtered.batches.map((b) => b.weighingStatus)).toEqual([
      'QUEUED',
      'QUEUED',
    ]);
  });

  it('keeps the receipt time, the source and the freshness UNCHANGED', () => {
    const filtered = filter.filter(queue as never, 'QUEUED');

    // The filtered view is a view of the SAME queue — the operator can
    // still see how old the underlying data is.
    expect(filtered.receivedAt).toEqual(RECEIVED_AT);
    expect(filtered.source).toBe('DUMMY_ORGATEX');
    expect(filtered.freshness).toEqual(CURRENT);
  });

  it('returns the whole queue for "All" — a null filter', () => {
    const filtered = filter.filter(queue as never, null);

    expect(filtered.batches).toHaveLength(3);
  });

  it('leaves the input queue untouched', () => {
    filter.filter(queue as never, 'QUEUED');

    expect(queue.batches).toHaveLength(3);
  });

  it('offers the DISTINCT statuses, in the queue\'s order', () => {
    const statuses = filter.statusesIn(queue as never);

    // Not the MES's vocabulary — the statuses PRESENT in this queue, in
    // the order they appear (ADR-030).
    expect(statuses).toEqual(['QUEUED', 'RELEASED']);
  });

  it('offers nothing for an empty queue — and "All" is always there', () => {
    const statuses = filter.statusesIn({ batches: [] } as never);

    expect(statuses).toEqual([]);
  });

  it('does NOT re-decide the freshness', () => {
    const aged = filter.filter(
      { ...queue, freshness: stale(42_000) } as never,
      'QUEUED',
    );

    expect(aged.freshness).toEqual({ kind: 'STALE', ageMs: 42_000 });
  });
});

describe('SelectBatch', () => {
  const operator = OperatorId.create('OP-001');

  function build(overrides: {
    readonly source?: StubSource;
    readonly scanner?: StubScanner;
    readonly selections?: StubRepository;
  } = {}): {
    readonly useCase: SelectBatch;
    readonly source: StubSource;
    readonly scanner: StubScanner;
    readonly selections: StubRepository;
  } {
    const source = overrides.source ?? new StubSource();
    const scanner = overrides.scanner ?? new StubScanner();
    const selections = overrides.selections ?? new StubRepository();

    const useCase = new SelectBatch({
      source,
      scanner,
      selections,
      clock: () => NOW,
    });

    return { useCase, source, scanner, selections };
  }

  // ── The touch path ──

  it('records a touch as TOUCH', async () => {
    const { useCase, selections } = build();

    const outcome = await useCase.executeByTouch('B-24187', operator);

    expect(outcome.kind).toBe('SELECTED');
    expect(selections.saved).toHaveLength(1);
    expect(selections.saved[0]?.selectionMethod).toBe('TOUCH');
  });

  it('records the batch, the operator and the moment of the act', async () => {
    const { useCase, selections } = build();

    await useCase.executeByTouch('B-24187', operator);

    const saved = selections.saved[0];
    expect(saved?.batchId.value).toBe('B-24187');
    expect(saved?.orderRef.value).toBe('SO-9931');
    expect(saved?.machineRef.value).toBe('JET-04');
    expect(saved?.operatorId.value).toBe('OP-001');
    expect(saved?.selectedAt.toDate()).toEqual(NOW);
  });

  // ── The scan path ──

  it('records a scan as SCAN', async () => {
    const { useCase, scanner, selections } = build();
    scanner.outcome = { kind: 'CODE_READ', code: 'B-24187' };

    const outcome = await useCase.executeByScan(operator);

    expect(outcome.kind).toBe('SELECTED');
    expect(selections.saved[0]?.selectionMethod).toBe('SCAN');
  });

  it('refuses a scan whose code names nothing the MES knows', async () => {
    const { useCase, scanner, selections } = build();
    scanner.outcome = { kind: 'CODE_READ', code: 'B-99999' };

    const outcome = await useCase.executeByScan(operator);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.refusal.reason).toBe('UNRECOGNISED_CODE');
    // A refusal writes NOTHING.
    expect(selections.saved).toHaveLength(0);
  });

  it('refuses an unrecognised code BEFORE eligibility is asked', async () => {
    // The code names nothing, so there is no batch to be ineligible — and
    // the refusal carries no eligibility reason at all.
    const { useCase, scanner } = build();
    scanner.outcome = { kind: 'CODE_READ', code: 'B-99999' };

    const outcome = await useCase.executeByScan(operator);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.refusal.reason).not.toBe('NOT_RELEASED');
    expect(outcome.refusal.reason).not.toBe('BEING_WEIGHED_ELSEWHERE');
  });

  it('reports a scanner that could not be read — distinctly from a refusal', async () => {
    const { useCase, scanner, selections } = build();
    scanner.outcome = { kind: 'NO_CODE', message: 'the scanner is disconnected' };

    const outcome = await useCase.executeByScan(operator);

    // Not a refusal: nothing was attempted, so there is no batch to
    // refuse. The operator is told the scanner is unavailable.
    expect(outcome.kind).toBe('SCANNER_UNAVAILABLE');
    expect(selections.saved).toHaveLength(0);
  });

  // ── The eligibility gate ──

  it('refuses a batch that is not eligible, with the SPECIFIC reason', async () => {
    const source = new StubSource();
    source.outcome = {
      kind: 'SUCCEEDED',
      snapshot: snapshot([
        releasedBatch({
          weighingStatus: 'WEIGHING',
          eligibility: {
            kind: 'NOT_ELIGIBLE',
            reason: 'BEING_WEIGHED_ELSEWHERE',
          },
        }),
      ]),
      freshness: CURRENT,
    };
    const { useCase, selections } = build({ source });

    const outcome = await useCase.executeByTouch('B-24187', operator);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.refusal.reason).toBe('BEING_WEIGHED_ELSEWHERE');
    // A refusal writes NOTHING.
    expect(selections.saved).toHaveLength(0);
  });

  it('refuses with each of the four ineligibility reasons', async () => {
    const reasons = [
      'NOT_RELEASED',
      'BEING_WEIGHED_ELSEWHERE',
      'ALREADY_WEIGHED',
      'CANCELLED',
    ] as const;

    for (const reason of reasons) {
      const source = new StubSource();
      source.outcome = {
        kind: 'SUCCEEDED',
        snapshot: snapshot([
          releasedBatch({
            eligibility: { kind: 'NOT_ELIGIBLE', reason },
          }),
        ]),
        freshness: CURRENT,
      };
      const { useCase } = build({ source });

      const outcome = await useCase.executeByTouch('B-24187', operator);

      expect(outcome.kind).toBe('REFUSED');
      if (outcome.kind !== 'REFUSED') return;
      expect(outcome.refusal.reason).toBe(reason);
    }
  });

  it('refuses a touch that names a batch the queue does not hold', async () => {
    const { useCase, selections } = build();

    const outcome = await useCase.executeByTouch('B-99999', operator);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.refusal.reason).toBe('UNKNOWN_BATCH');
    expect(selections.saved).toHaveLength(0);
  });

  it('reads the eligibility from the SNAPSHOT — the projection is not consulted', async () => {
    // The projection deliberately does not carry the eligibility, so a
    // selection that could only work off the projection would have to
    // re-derive it — and two copies of the rule would eventually disagree
    // (ADR-028).
    const source = new StubSource();
    source.outcome = {
      kind: 'SUCCEEDED',
      snapshot: snapshot([
        releasedBatch({ eligibility: { kind: 'ELIGIBLE' } }),
      ]),
      freshness: CURRENT,
    };
    const { useCase } = build({ source });

    const outcome = await useCase.executeByTouch('B-24187', operator);

    expect(outcome.kind).toBe('SELECTED');
  });

  // ── The filter is never a gate ──

  it('reads the queue WITHOUT a filter — the filter is a view, never a gate', async () => {
    const { useCase, source } = build();

    await useCase.executeByTouch('B-24187', operator);

    // No filter was passed. A scan of a batch that is not in the currently
    // displayed (filtered) queue still succeeds.
    expect(source.filters).toEqual([undefined]);
  });

  it('selects a batch that is NOT in the filtered queue, because eligibility is what gates', async () => {
    // The story's edge case: the operator has the queue filtered to
    // `QUEUED`, and scans a card for a `RELEASED` batch that is not on
    // screen. The selection succeeds — the filter is a view concern only.
    const source = new StubSource();
    source.outcome = {
      kind: 'SUCCEEDED',
      snapshot: snapshot([
        releasedBatch({ batchId: 'B-24190', weighingStatus: 'RELEASED' }),
      ]),
      freshness: CURRENT,
    };
    const { useCase } = build({ source });

    const outcome = await useCase.executeByTouch('B-24190', operator);

    expect(outcome.kind).toBe('SELECTED');
    expect(source.filters).toEqual([undefined]);
  });

  // ── The active selection ──

  it('reports no selection before anything has been chosen', async () => {
    const { useCase } = build();

    expect(await useCase.current()).toBeNull();
  });

  it('reports the newest selection as the active one', async () => {
    // The queue must hold BOTH batches, or the second touch would be
    // refused as an unknown batch — which is the gate working, not a
    // failure of this test.
    const source = new StubSource();
    source.outcome = {
      kind: 'SUCCEEDED',
      snapshot: snapshot([
        releasedBatch({ batchId: 'B-24187' }),
        releasedBatch({ batchId: 'B-24190' }),
      ]),
      freshness: CURRENT,
    };
    const { useCase, selections } = build({ source });

    await useCase.executeByTouch('B-24187', operator);
    await useCase.executeByTouch('B-24190', operator);

    const current = await useCase.current();
    expect(current?.batchId.value).toBe('B-24190');
    // Both acts are in the history — the record is append-only.
    expect(selections.saved).toHaveLength(2);
  });

  it('records a repeated selection of the same batch as a NEW selection', async () => {
    const { useCase, selections } = build();

    await useCase.executeByTouch('B-24187', operator);
    await useCase.executeByTouch('B-24187', operator);

    // One ACTIVE selection, with the latest method and timestamp — and
    // the history keeps both.
    expect(selections.saved).toHaveLength(2);
    expect((await useCase.current())?.batchId.value).toBe('B-24187');
  });
});
