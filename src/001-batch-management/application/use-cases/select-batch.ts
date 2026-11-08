/**
 * SelectBatch — the write use case.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE GATE, AND WHAT IT MAY NOT DO.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD BR-03: *"The business must not permit weighing against a batch
 * OrgaTEX has not released."* This use case is where that is enforced.
 *
 * The eligibility **derivation** is unit 005's — it holds the MES's status
 * vocabulary and the rule that maps it — and this unit **enforces** it.
 * Two copies of the rule would eventually disagree (ADR-028), so this unit
 * reads the eligibility **from unit 005's snapshot** and never re-derives
 * it, and never reads it from the projection (which deliberately does not
 * carry it).
 *
 * A REFUSAL WRITES NOTHING
 * -----------------------
 * The refusal path returns before the repository is touched. A refused
 * selection leaves **no row**, so the history contains only acts that
 * happened — and the "latest selection" can never be a refusal.
 *
 * THE FILTER IS NEVER A GATE
 * -------------------------
 * Both paths read the queue **without a filter**. The story is explicit:
 *
 * > "A scan resolves to a batch in `RELEASED` status that is not in the
 * > currently displayed (filtered) queue → the selection succeeds, because
 * > eligibility is governed by status, not by the current filter; the queue
 * > filter is a view concern only."
 *
 * THE METHOD IS DERIVED, NEVER SUPPLIED
 * -------------------------------------
 * `executeByTouch` records `TOUCH`; `executeByScan` records `SCAN`. There
 * is no path that accepts a method from a caller, so a false claim cannot
 * be written into an immutable traceability record (ADR-030, ADR-029).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { BatchQueueSnapshot } from '../../../005-orgatex-integration/domain/entities/snapshots.js';
import type { ReleasedBatch } from '../../../005-orgatex-integration/domain/entities/snapshots.js';
import type { BatchQueueSource } from '../../domain/ports/batch-queue-source.js';
import type { BatchScanner } from '../../domain/ports/batch-scanner.js';
import type { BatchSelectionRepository } from '../../domain/ports/batch-selection-repository.js';
import { BatchSelection } from '../../domain/entities/batch-selection.js';
import type { SelectionMethod } from '../../domain/value-objects/selection-method.js';
import type {
  SelectionRefusal,
  SelectionRefusalReason,
} from '../../domain/value-objects/selection-refusal.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';

/**
 * The outcome of a selection attempt.
 *
 * A **union**, never a thrown error: a refusal is a normal outcome with a
 * reason, and the caller must render that reason to the operator.
 */
export type SelectionOutcome =
  | { readonly kind: 'SELECTED'; readonly selection: BatchSelection }
  | { readonly kind: 'REFUSED'; readonly refusal: SelectionRefusal }
  | {
      /**
       * The scanner could not be read at all.
       *
       * Distinct from a refusal: nothing was attempted, so there is no
       * batch and no reason to refuse one. The operator is told the
       * scanner is unavailable and may fall back to touching the row
       * (B-6).
       */
      readonly kind: 'SCANNER_UNAVAILABLE';
      readonly message: string;
    };

export interface SelectBatchOptions {
  /** The seam the batch is looked up in. */
  readonly source: BatchQueueSource;
  /** The device the code is read from. */
  readonly scanner: BatchScanner;
  /** Where the selection is recorded. */
  readonly selections: BatchSelectionRepository;
  /** The clock — the selection is timestamped. */
  readonly clock: () => Date;
  /**
   * Where a failure's diagnostic goes.
   *
   * The **detail** never reaches the client (BRD IR-09); the client is
   * told the reason code and nothing else.
   */
  readonly onError?: (detail: string) => void;
}

export class SelectBatch {
  constructor(private readonly options: SelectBatchOptions) {}

  /**
   * Select a batch by **touching its row**.
   *
   * @param batchId The batch the operator touched.
   * @param operatorId The signed-in operator — from the session, never
   *                   from a request body.
   */
  async executeByTouch(
    batchId: string,
    operatorId: OperatorId,
  ): Promise<SelectionOutcome> {
    const found = await this.findInQueue(batchId);
    if (found === undefined) {
      return this.refuse(
        'UNKNOWN_BATCH',
        `The released queue has no batch ${batchId}`,
      );
    }

    return this.record(found, operatorId, 'TOUCH');
  }

  /**
   * Select a batch by **scanning its card**.
   *
   * @param operatorId The signed-in operator — from the session, never
   *                   from a request body.
   */
  async executeByScan(operatorId: OperatorId): Promise<SelectionOutcome> {
    const scan = await this.options.scanner.read();

    if (scan.kind === 'NO_CODE') {
      this.options.onError?.(
        `[batch-selection] the scanner produced no code: ${scan.message}`,
      );
      return { kind: 'SCANNER_UNAVAILABLE', message: scan.message };
    }

    const found = await this.findInQueue(scan.code);
    if (found === undefined) {
      return this.refuse(
        'UNRECOGNISED_CODE',
        `The scanned code "${scan.code}" names no batch in the released queue`,
      );
    }

    return this.record(found, operatorId, 'SCAN');
  }

  /**
   * The newest selection — the active one.
   *
   * `null` when nothing has been chosen yet. An empty selection is a
   **state**, not an error, and it is never a `404`.
   */
  async current(): Promise<BatchSelection | null> {
    return this.options.selections.latest();
  }

  /**
   * Find a batch in the released queue.
   *
   * The queue is read **without a filter** — the filter is a view and is
   * never a gate.
   *
   * @returns The batch, or `undefined` when the queue does not hold it.
   */
  private async findInQueue(
    batchId: string,
  ): Promise<ReleasedBatch | undefined> {
    const outcome = await this.options.source.read();

    if (outcome.kind === 'FAILED') {
      this.options.onError?.(
        `[batch-selection] the released queue is unavailable (${outcome.reason}): ${outcome.message}`,
      );
      return undefined;
    }

    const snapshot: BatchQueueSnapshot = outcome.snapshot;

    // The comparison is exact — `BatchId` is a bounded, trimmed identifier
    // and the queue's ids were built through the same factory, so equal
    // ids are equal strings. No normalisation, no case folding: two ids
    // that differ only in case are two different batches.
    const wanted = BatchId.create(batchId);
    return snapshot.batches.find((batch) => batch.batchId.equals(wanted));
  }

  /**
   * Apply the eligibility gate and, if it passes, record the selection.
   */
  private async record(
    batch: ReleasedBatch,
    operatorId: OperatorId,
    method: SelectionMethod,
  ): Promise<SelectionOutcome> {
    const eligibility = batch.eligibility;

    if (eligibility.kind === 'NOT_ELIGIBLE') {
      // The reason is unit 005's, carried unchanged. This unit enforces
      // the gate; it does not own the vocabulary that decides it.
      return this.refuse(
        eligibility.reason,
        `Batch ${batch.batchId.value} is not eligible (${eligibility.reason})`,
      );
    }

    const selection = new BatchSelection(
      batch.batchId,
      batch.orderRef,
      batch.machineRef,
      operatorId,
      Instant.of(this.options.clock()),
      method,
    );

    await this.options.selections.save(selection);

    return { kind: 'SELECTED', selection };
  }

  /** A refusal. Nothing is written. */
  private refuse(
    reason: SelectionRefusalReason,
    message: string,
  ): SelectionOutcome {
    this.options.onError?.(`[batch-selection] the selection was refused: ${message}`);
    return { kind: 'REFUSED', refusal: { reason, message } };
  }
}
