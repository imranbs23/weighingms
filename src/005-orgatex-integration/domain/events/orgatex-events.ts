/**
 * The domain events of the OrgaTEX seam.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THESE EVENTS ARE ABOUT CONTACT, NOT ABOUT DATA.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A `BatchQueueRead` says "we reached the MES and this is what it said". It
 * does NOT say "a batch was released" or "a batch changed" — the MES owns
 * those facts, and when they happened.
 *
 * That is why there is no `BatchReleased` event. Inventing one would
 * create a **second source of truth** for when a batch was released: the
 * MES's own record, and this unit's inferred one from the difference
 * between two snapshots. The inferred one would be wrong whenever a read
 * was missed — and it would be **invisible** when it was wrong.
 *
 * These events are also what feeds the link state's consecutive-failure
 * counter in bolt `007`. This unit produces the observations; bolt `007`
 * owns the machine that interprets them.
 */
import type { AdapterFailureReason } from '../ports/orgatex-adapter.js';
import type { BatchStatusFilter } from '../ports/orgatex-adapter.js';
import type { BatchId } from '../value-objects/identifiers.js';

export interface BatchQueueRead {
  readonly type: 'BATCH_QUEUE_READ';
  readonly batchCount: number;
  readonly receivedAt: Date;
  readonly source: string;
  /** The filter the read was made under — a filtered read and an
   *  unfiltered read produce different snapshots. */
  readonly filter: BatchStatusFilter | null;
}

export interface BatchQueueReadFailed {
  readonly type: 'BATCH_QUEUE_READ_FAILED';
  readonly reason: AdapterFailureReason;
  readonly at: Date;
  /** For the LOG, never for the client (BRD IR-09). */
  readonly message: string;
}

export interface RecipeRead {
  readonly type: 'RECIPE_READ';
  readonly batchId: BatchId;
  readonly componentCount: number;
  readonly receivedAt: Date;
  readonly source: string;
}

export interface RecipeReadFailed {
  readonly type: 'RECIPE_READ_FAILED';
  readonly batchId: BatchId;
  readonly reason: AdapterFailureReason;
  readonly at: Date;
  /** For the LOG, never for the client (BRD IR-09). */
  readonly message: string;
}

export type OrgatexEvent =
  | BatchQueueRead
  | BatchQueueReadFailed
  | RecipeRead
  | RecipeReadFailed;
