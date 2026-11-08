/**
 * BatchSummary — the batch's completion report.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PROJECTION OF THE RECORDS. NEVER A SECOND COPY OF THEM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The summary **reads** the immutable weighing records and states what
 * they say. It is **not** a record of an act — the acts are the records
 * (BRD DR-02, C-12) — so it is not stored, and it cannot disagree with
 * them.
 *
 * AND THE TOLERANCE VERDICT IS A QUALITY SIGNAL
 * ---------------------------------------------
 * *"`YES` only when every confirmed weighing was in the `OK` zone."*
 *
 * And a component confirmed under a supervisor override was **not** within
 * tolerance — so the verdict is `NO`. That is what makes the summary
 * usable: the override's record carries the **over-dose** zone (bolt
 * `016`), so the verdict reads the zone and needs to know nothing about
 * overrides at all.
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

/**
 * Whether every confirmed weighing was within tolerance.
 *
 * **Two values, never three.** There is no "partially within tolerance" —
 * a batch is either shippable within tolerance or it is not.
 */
export type ToleranceVerdict = 'YES' | 'NO';

/**
 * The OrgaTEX write-back's state.
 *
 * **`PENDING` does not un-complete the batch.** The material is weighed
 * and in the container whether or not the MES heard about it; the queue
 * delivers the pending posting when the link returns (BRD FR-30, FR-31,
 * NFR-03).
 */
export type WriteBackState = 'CONFIRMED' | 'PENDING' | 'FAILED';

export interface BatchSummary {
  /** The batch this summarises. */
  readonly batchId: string;
  /** The session that weighed it. */
  readonly sessionId: string;
  /** How many components were weighed, of the recipe's total. */
  readonly completedCount: number;
  readonly totalCount: number;
  /** The elapsed time, from the session's `startedAt` to the completion. */
  readonly elapsedSeconds: number;
  /** The operator who weighed it. */
  readonly operatorId: string;
  /** The total dispensed — converted and summed, in kilograms. */
  readonly totalDispensed: WeightValue;
  /** Whether every confirmed weighing was in the `OK` zone. */
  readonly allWithinTolerance: ToleranceVerdict;
  /** The write-back's state. */
  readonly writeBack: WriteBackState;
  /** When the write-back was confirmed — `null` until it is. */
  readonly writeBackConfirmedAt: Date | null;
  /** Whether the container is released for transport. */
  readonly releasedForTransport: boolean;
  /** The machine the container is going to. */
  readonly targetMachine: string;
}

/**
 * The tolerance verdict, from the confirmed records' zones.
 *
 * **`YES` only when EVERY zone is `OK`.** An empty set is `NO` — a batch
 * with no confirmed weighings has not been shown to be within tolerance.
 */
export function toleranceVerdict(
  zones: readonly string[],
): ToleranceVerdict {
  if (zones.length === 0) return 'NO';
  return zones.every((zone) => zone === 'OK') ? 'YES' : 'NO';
}
