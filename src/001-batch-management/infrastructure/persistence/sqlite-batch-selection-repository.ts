/**
 * SqliteBatchSelectionRepository — the durable record of the operator's
 * choice.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite a selection (BRD DR-02). The database's triggers are the
 * second line of the same guarantee — a repository convention holds against
 * a careless caller; a trigger holds against everyone (ADR-029).
 *
 * THE ACTIVE SELECTION IS THE NEWEST ROW
 * ---------------------------------------
 * Not a flag, not a `superseded_at`. The ordering is **total**:
 * `selected_at DESC, id DESC`. `selected_at` alone is ambiguous when two
 * selections land in the same millisecond, and "the latest" must have
 * exactly one answer — two terminals reading the active selection must not
 * be able to disagree.
 */
import { randomUUID } from 'node:crypto';
import { BatchSelection } from '../../domain/entities/batch-selection.js';
import type { BatchSelectionRepository } from '../../domain/ports/batch-selection-repository.js';
import {
  isSelectionMethod,
} from '../../domain/value-objects/selection-method.js';
import {
  BatchId,
  MachineRef,
  OrderRef,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SqliteDatabase } from './batch-selection-database.js';

interface SelectionRow {
  id: number;
  batch_id: string;
  order_ref: string;
  machine_ref: string;
  operator_id: string;
  selected_at: string;
  selection_method: string;
  recorded_at: string;
}

export class SqliteBatchSelectionRepository implements BatchSelectionRepository {
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The row's identifier is assigned by the database — it is the
   * **insertion sequence**, and it is what breaks a tie when two
   * selections land in the same millisecond. The tie is broken in the
   * order the acts HAPPENED, not at random (ADR-029).
   *
   * The `selected_at` is the **act's** time while `recorded_at` is the
   * **write's** time — two different moments, kept apart deliberately.
   */
  async save(selection: BatchSelection): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO batch_selections
           (batch_id, order_ref, machine_ref, operator_id,
            selected_at, selection_method, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        selection.batchId.value,
        selection.orderRef.value,
        selection.machineRef.value,
        selection.operatorId.value,
        selection.selectedAt.toString(),
        selection.selectionMethod,
        this.clock().toISOString(),
      );
  }

  /**
   * The newest selection — the active one.
   *
   * `null` when nothing has been chosen yet. An empty selection is a
   * **state**, not an error.
   */
  async latest(): Promise<BatchSelection | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM batch_selections
          ORDER BY selected_at DESC, id DESC
          LIMIT 1`,
      )
      .get() as unknown as SelectionRow | undefined;

    return row === undefined ? null : toSelection(row);
  }
}

/**
 * Rebuild a selection from its row.
 *
 * The method is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toSelection(row: SelectionRow): BatchSelection {
  if (!isSelectionMethod(row.selection_method)) {
    throw new Error(
      `The stored selection method "${row.selection_method}" is not one this product records`,
    );
  }

  return new BatchSelection(
    BatchId.create(row.batch_id),
    OrderRef.create(row.order_ref),
    MachineRef.create(row.machine_ref),
    OperatorId.create(row.operator_id),
    Instant.of(new Date(row.selected_at)),
    row.selection_method,
  );
}
