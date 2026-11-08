/**
 * The batch management composition root.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the module wires the use case to the port it was given
 *   - the port is exposed, so the binding is discoverable
 *   - a failure's diagnostic reaches the bound error handler
 *   - the module works with NO error handler bound (the default path)
 *   - the selection's two ports are bound to the implementations given
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The composition root is where unit 001 and unit 005 meet (ADR-028), and
 * that meeting is the one thing in this bolt that could go wrong in a way
 * no other test would notice. So the binding is asserted directly: the
 * source the module was given IS the source the use case reads through.
 *
 * The same argument applies to the selection's ports. The scanner and the
 * repository are the station's other two outbound surfaces, and a second
 * reader of either would be a second source of truth.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBatchManagementModule,
} from '../../src/001-batch-management/infrastructure/composition-root.js';
import { RetrieveBatchQueue } from '../../src/001-batch-management/application/use-cases/retrieve-batch-queue.js';
import { SelectBatch } from '../../src/001-batch-management/application/use-cases/select-batch.js';
import { BatchQueueProjector } from '../../src/001-batch-management/domain/services/batch-queue-projector.js';
import { BatchQueueFilter } from '../../src/001-batch-management/domain/services/batch-queue-filter.js';
import type { BatchQueueSource } from '../../src/001-batch-management/domain/ports/batch-queue-source.js';
import type {
  BatchScanner,
  ScanOutcome,
} from '../../src/001-batch-management/domain/ports/batch-scanner.js';
import type { BatchSelectionRepository } from '../../src/001-batch-management/domain/ports/batch-selection-repository.js';
import type { BatchSelection } from '../../src/001-batch-management/domain/entities/batch-selection.js';
import type { BatchQueueReadOutcome } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';

/** A source a test drives directly. */
class StubSource implements BatchQueueSource {
  outcome: BatchQueueReadOutcome = {
    kind: 'FAILED',
    reason: 'UNREACHABLE',
    message: 'the seam is down',
  };
  reads = 0;
  /** The filters the use case passed, in order. */
  filters: (string | undefined)[] = [];

  async read(filter?: string): Promise<BatchQueueReadOutcome> {
    this.reads += 1;
    this.filters.push(filter);
    return this.outcome;
  }
}

/** A scanner a test drives directly. */
class StubScanner implements BatchScanner {
  outcome: ScanOutcome = { kind: 'NO_CODE', message: 'nothing was presented' };

  async read(): Promise<ScanOutcome> {
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

describe('the batch management composition root', () => {
  it('binds the use case to the source it was given', async () => {
    const source = new StubSource();
    const module = buildBatchManagementModule({
      source,
      scanner: new StubScanner(),
      selections: new StubRepository(),
    });

    expect(module.retrieveBatchQueue).toBeInstanceOf(RetrieveBatchQueue);
    expect(module.selectBatch).toBeInstanceOf(SelectBatch);
    expect(module.projector).toBeInstanceOf(BatchQueueProjector);
    expect(module.filter).toBeInstanceOf(BatchQueueFilter);

    // The binding is the SAME source — so there is exactly one reader of
    // the seam, and a future second reader would be visible here.
    expect(module.queueSource).toBe(source);

    await module.retrieveBatchQueue.execute();
    expect(source.reads).toBe(1);
  });

  it('binds the selection\'s scanner and repository to the ones it was given', async () => {
    const scanner = new StubScanner();
    const selections = new StubRepository();
    const module = buildBatchManagementModule({
      source: new StubSource(),
      scanner,
      selections,
    });

    // The bindings are discoverable, not hidden.
    expect(module.scanner).toBe(scanner);
    expect(module.selections).toBe(selections);
  });

  it('reads the WHOLE queue from the source — the filter is applied locally', async () => {
    const source = new StubSource();
    const module = buildBatchManagementModule({
      source,
      scanner: new StubScanner(),
      selections: new StubRepository(),
    });

    await module.retrieveBatchQueue.execute('WEIGHING');
    await module.retrieveBatchQueue.execute(null);

    // The filter is NOT pushed into the seam. Two reasons: the statuses
    // the operator may filter TO must come from the whole queue, and a
    // filtered read would put a FILTERED queue into unit 005's cache — so
    // the DEGRADED fallback would later serve the partial queue as though
    // it were the whole released schedule.
    expect(source.filters).toEqual([undefined, undefined]);
  });

  it('routes a failure\'s diagnostic to the bound error handler', async () => {
    const logged: string[] = [];
    const module = buildBatchManagementModule({
      source: new StubSource(),
      scanner: new StubScanner(),
      selections: new StubRepository(),
      onError: (detail) => logged.push(detail),
    });

    await module.retrieveBatchQueue.execute();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('UNREACHABLE');
    expect(logged[0]).toContain('the seam is down');
  });

  it('works with no error handler bound at all', async () => {
    const module = buildBatchManagementModule({
      source: new StubSource(),
      scanner: new StubScanner(),
      selections: new StubRepository(),
    });

    const availability = await module.retrieveBatchQueue.execute();

    expect(availability.kind).toBe('UNAVAILABLE');
  });
});
