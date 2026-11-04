/**
 * BatchQueueProjector — the mapping from unit 005's snapshot to this
 * unit's projection.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO CLOCK, NO ADAPTER, NO CACHE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A projector that computed the receipt time itself would report the
 * **render** time, not the **receipt** time — and the story is explicit
 * that `receivedAt` must be *"the time the list was last received from
 * the upstream system"*, not the time the client asked. So the receipt
 * time is unit 005's fact, and the projector copies it.
 *
 * WHY THE PROJECTION IS NOT THE SNAPSHOT
 * --------------------------------------
 * The two answer different questions:
 *
 *   unit 005's snapshot   "what did the MES say, and is it current?"
 *   this projection        "what work is on offer at this station?"
 *
 * The snapshot carries the MES's own fields plus an eligibility this unit
 * does not enforce; the projection carries the seven display columns and
 * nothing else. Duplicating the four identifier field names is the
 * **point** — the two surfaces are allowed to diverge (ADR-028).
 */
import {
  StationBatch,
  StationBatchQueue,
} from '../entities/station-batch-queue.js';
import type {
  BatchQueueSnapshot,
  ReleasedBatch,
} from '../../../005-orgatex-integration/domain/entities/snapshots.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';

export class BatchQueueProjector {
  /**
   * Project a snapshot into the station's queue.
   *
   * @param snapshot  Unit 005's snapshot.
   * @param freshness Unit 005's freshness decision, passed through
   *                    unchanged. It is a **parameter**, not something
   *                    this class computes, because deciding staleness is
   *                    unit 005's job (ADR-028).
   */
  project(
    snapshot: BatchQueueSnapshot,
    freshness: SnapshotFreshness,
  ): StationBatchQueue {
    return new StationBatchQueue(
      snapshot.batches.map((batch) => this.projectBatch(batch)),
      snapshot.receivedAt.toDate(),
      snapshot.source,
      freshness,
    );
  }

  /** Project one batch. */
  private projectBatch(batch: ReleasedBatch): StationBatch {
    return new StationBatch(
      batch.batchId,
      batch.orderRef,
      batch.machineRef,
      normaliseDescription(batch.fabricDescription),
      batch.shadeCode,
      batch.componentCount,
      batch.weighingStatus,
    );
  }
}

/**
 * Normalise an absent description to `null`.
 *
 * The story's edge case: *"A batch is missing one of the seven fields →
 * the row renders with an explicit placeholder for the missing field; the
 * row is not silently dropped."* So the row survives, and the missing
 * field is **shaped** as `null` so the UI can render its own placeholder.
 *
 * A **blank** string is treated as absent, because `""` is not a fabric
 * description — it is the MES saying nothing, in the shape that looks
 * like saying something. `null` says it in one token.
 *
 * Note what is NOT done here: the seven columns are otherwise carried
 * **verbatim**. This unit derives none of them.
 */
function normaliseDescription(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
