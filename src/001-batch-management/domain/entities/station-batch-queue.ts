/**
 * The station's own model of the released batch queue.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PROJECTION, NOT A COPY OF THE MES's TRUTH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A batch belongs to OrgaTEX. What this unit holds is a **point-in-time
 * copy** of somebody else's truth, taken through a read-only seam, and
 * that copy carries a **provenance** — when it was received, and from
 * where.
 *
 * The provenance is the whole point. A queue without a receipt time cannot
 * be distinguished from a queue that is current, and the operator cannot
 * tell whether they are looking at this shift's work or at a list from an
 * hour ago.
 *
 * WHY THERE IS NO `releasedAt` ON A ROW
 * -------------------------------------
 * The MES's payload does not supply one. Inventing it would be a
 * fabricated field — a plausible-looking timestamp that means nothing.
 * The receipt time of the **queue** is known and is carried; the release
 * time of an **individual batch** is not known, and is therefore absent
 * rather than invented. If FCI confirms the MES supplies it (Q-01), it
 * arrives with the next read.
 *
 * WHY THERE IS NO `eligibility` ON A ROW
 * --------------------------------------
 * Unit 005 computes it, and unit 005's docstring says who owns it:
 * *"The **refusal** belongs to unit `001-batch-management`, which owns the
 * selection state machine."* Bolt 009 enforces it, on the snapshot.
 *
 * A row that carried a gate it did not enforce would invite a reader to
 * assume it did. So the projection carries **what the operator sees** —
 * the seven FR-1 columns — and nothing else.
 */
import type { BatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import type {
  BatchId,
  MachineRef,
  OrderRef,
  ShadeCode,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

/**
 * One batch as this station sees it.
 *
 * The seven properties are exactly the seven columns FR-1 names, and they
 * are carried **verbatim** — this unit derives none of them.
 */
export class StationBatch {
  constructor(
    readonly batchId: BatchId,
    readonly orderRef: OrderRef,
    readonly machineRef: MachineRef,
    /**
     * The fabric description, or `null` when the MES gave none.
     *
     * `null` and not `""`, because the placeholder's **text** belongs to
     * the UI (BRD NFR-11, FR-22). The API must be able to say *"there is
     * no description here"* without saying what to put there.
     */
    readonly fabricDescription: string | null,
    readonly shadeCode: ShadeCode,
    /** A **count** of recipe slots — not a quantity (ADR-008). */
    readonly componentCount: number,
    readonly weighingStatus: BatchWeighingStatus,
  ) {}
}

/**
 * The released queue **as this station received it**.
 *
 * Immutable once constructed, and the rows are in the **MES's order** —
 * the projection does not re-sort them. A queue the operator sees in a
 * different order than the MES released it would be a queue whose
 * ordering rule nobody could name.
 */
export class StationBatchQueue {
  constructor(
    readonly batches: readonly StationBatch[],
    /** When the queue was **received from the upstream**. */
    readonly receivedAt: Date,
    /** Which adapter produced the queue — makes a degraded read attributable. */
    readonly source: string,
    /**
     * Unit 005's freshness decision, **passed through unchanged**.
     *
     * This unit does not re-decide staleness — the threshold that decides
     * it is unit 005's freshness window, and that window is configuration
     * (BRD NFR-14) which the UI does not have. But the UI must be able to
     * tell an old queue from a current one, so the decision travels with
     * the queue (ADR-028).
     */
    readonly freshness: SnapshotFreshness,
  ) {}

  /** How many batches the queue holds. */
  get count(): number {
    return this.batches.length;
  }
}
