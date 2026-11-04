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
 */
import { RetrieveBatchQueue } from '../application/use-cases/retrieve-batch-queue.js';
import { BatchQueueProjector } from '../domain/services/batch-queue-projector.js';
import type { BatchQueueSource } from '../domain/ports/batch-queue-source.js';

export interface BatchManagementModule {
  /** The read use case. */
  readonly retrieveBatchQueue: RetrieveBatchQueue;
  /** The projector, so a caller can inspect the projection itself. */
  readonly projector: BatchQueueProjector;
  /**
   * The seam this unit reads through.
   *
   * Exposed so that a test — or a future bolt — can prove the read went
   * through it, and so the binding is discoverable rather than hidden.
   */
  readonly queueSource: BatchQueueSource;
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

  const retrieveBatchQueue = new RetrieveBatchQueue({
    source: options.source,
    projector,
    ...(options.onError === undefined
      ? {}
      : { onError: options.onError }),
  });

  return {
    retrieveBatchQueue,
    projector,
    queueSource: options.source,
  };
}
