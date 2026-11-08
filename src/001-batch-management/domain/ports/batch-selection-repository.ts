/**
 * BatchSelectionRepository — the durable record of the operator's choice.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is deliberately **no** update method and **no** delete method, so
 * there is nothing that *could* rewrite a selection (BRD DR-02). The
 * immutability is enforced by the absence of a path, and additionally by
 * `BEFORE UPDATE` and `BEFORE DELETE` triggers in the storage layer
 * (ADR-029).
 *
 * THE ACTIVE SELECTION IS THE NEWEST ROW
 * ---------------------------------------
 * Not a flag, not a `superseded_at` column, not a pointer table. The
 * repository exposes exactly two methods, so no caller can accidentally
 * treat the table as holding a single row.
 */
import type { BatchSelection } from '../entities/batch-selection.js';

export interface BatchSelectionRepository {
  /**
   * Record a selection.
   *
   * Append-only. The repository has no way to change or remove a row.
   */
  save(selection: BatchSelection): Promise<void>;

  /**
   * The **newest** selection — the active one.
   *
   * @returns The latest selection, or `null` when nothing has been chosen
   *          yet. An empty selection is a **state**, not an error.
   */
  latest(): Promise<BatchSelection | null>;
}
