/**
 * The composition root — where unit 001's layers are wired.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PORT IS BOUND HERE, AND ONLY HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `BatchQueueReader` satisfies `BatchQueueSource` structurally — its
 * `read(filter?)` accepts a call with no arguments — so the binding needs
 * no adapter class and no mapping layer between the two units.
 *
 * That binding is the **whole** of the coupling. Unit 001 never imports
 * the reader class, and never holds an `OrgatexAdapter`, a credential or
 * a socket. So there is exactly **one** reader of the MES seam, one
 * contact per read, and one cache (ADR-028).
 *
 * A reviewer looking for a second path to the MES will find it here: one
 * line, one port, one implementation. If a second reader is ever added,
 * it is visible in this file.
 *
 * THE SELECTION'S PORTS ARE BOUND HERE TOO
 * -----------------------------------------
 * The scanner and the selection repository are bound in exactly the same
 * way — one line, one port, one implementation — so a reviewer can see
 * the whole of the station's outbound surface in one file.
 *
 * THE CLOCK IS INJECTED
 * ---------------------
 * The selection is **timestamped**, so something must supply the time.
 * It is injected rather than read from `Date.now()` inside the use case,
 * because a test that stamps a selection needs to know exactly what time
 * was recorded — and because the receipt time is unit 005's fact, so this
 * unit's clock is only ever about **its own** act.
 */
import { RetrieveBatchQueue } from '../application/use-cases/retrieve-batch-queue.js';
import { SelectBatch } from '../application/use-cases/select-batch.js';
import { BatchQueueProjector } from '../domain/services/batch-queue-projector.js';
import { BatchQueueFilter } from '../domain/services/batch-queue-filter.js';
import type { BatchQueueSource } from '../domain/ports/batch-queue-source.js';
import type { BatchScanner } from '../domain/ports/batch-scanner.js';
import type { BatchSelectionRepository } from '../domain/ports/batch-selection-repository.js';

export interface BatchManagementModule {
  /** The read use case. */
  readonly retrieveBatchQueue: RetrieveBatchQueue;
  /** The selection use case. */
  readonly selectBatch: SelectBatch;
  /** The projector, so a caller can inspect the projection itself. */
  readonly projector: BatchQueueProjector;
  /** The filter, so a caller can inspect the filter itself. */
  readonly filter: BatchQueueFilter;
  /**
   * The seam this unit reads through.
   *
   * Exposed so that a test — or a future bolt — can prove the read went
   * through it, and so the binding is discoverable rather than hidden.
   */
  readonly queueSource: BatchQueueSource;
  /** The scanner the scan path reads through. */
  readonly scanner: BatchScanner;
  /** The repository the selection is recorded in. */
  readonly selections: BatchSelectionRepository;
}

export interface BuildBatchManagementOptions {
  /**
   * Where the released queue comes from.
   *
   * In production this is unit 005's `BatchQueueReader`. A test may bind a
   * controlled source that returns a specific failure.
   */
  readonly source: BatchQueueSource;
  /**
   * Where the scanner's codes come from.
   *
   * In production this is the station's scanner adapter. A test may bind a
   * controlled scanner that presents a specific code — or none.
   */
  readonly scanner: BatchScanner;
  /**
   * Where the selection is recorded.
   *
   * In production this is the SQLite repository. A test may bind an
   * in-memory one.
   */
  readonly selections: BatchSelectionRepository;
  /**
   * The clock — the selection is timestamped.
   *
   * Defaults to the system clock. A test injects a fixed one.
   */
  readonly clock?: () => Date;
  /**
   * Where a failure's diagnostic goes.
   *
   * Defaults to the console, because an undiagnosed MES failure is the
   * thing BRD IR-09 exists to prevent.
   */
  readonly onError?: (detail: string) => void;
}

export function buildBatchManagementModule(
  options: BuildBatchManagementOptions,
): BatchManagementModule {
  const projector = new BatchQueueProjector();
  const filter = new BatchQueueFilter();

  const retrieveBatchQueue = new RetrieveBatchQueue({
    source: options.source,
    projector,
    filter,
    ...(options.onError === undefined
      ? {}
      : { onError: options.onError }),
  });

  const selectBatch = new SelectBatch({
    source: options.source,
    scanner: options.scanner,
    selections: options.selections,
    clock: options.clock ?? (() => new Date()),
    ...(options.onError === undefined
      ? {}
      : { onError: options.onError }),
  });

  return {
    retrieveBatchQueue,
    selectBatch,
    projector,
    filter,
    queueSource: options.source,
    scanner: options.scanner,
    selections: options.selections,
  };
}
