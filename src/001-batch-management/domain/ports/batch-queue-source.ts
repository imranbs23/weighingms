/**
 * BatchQueueSource — the port through which unit 001 reads the MES.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PORT ASKS FOR THE WHOLE QUEUE. IT DOES NOT ASK FOR A FILTERED ONE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Bolt 009 grew this port with a `filter` parameter, and then removed it
 * again. The reason is worth recording, because the removal looks like a
 * step backwards and is not.
 *
 * The filter has to be applied in **two** places at once, and only one of
 * them can be this unit:
 *
 *   1. the ROWS the operator sees — this unit's business; and
 *   2. the STATUSES the filter control OFFERS — which must come from the
 *      whole queue, or the control becomes a one-way door (ADR-030).
 *
 * A single read that arrives already filtered can satisfy (1) and not (2).
 * And the failure of (2) is not cosmetic — it is a **correctness** bug
 * with a second, worse face:
 *
 *   THE CACHE
 *   ---------
 *   Unit 005's reader caches the snapshot it built, and that snapshot is
 *   the one it was asked for. So a filtered read would put a **filtered**
 *   queue into the cache — and the reader's DEGRADED fallback would later
 *   serve that partial queue as though it were the whole released
 *   schedule. The operator would see three `QUEUED` batches and believe
 *   that was all the work on offer.
 *
 *   So the filter must NOT reach the seam. This unit reads the whole
 *   released queue and narrows it on its own rows.
 *
 * The MES's own filtering (BRD IR-01) is untouched: unit 005's reader
 * still accepts a filter, still passes it to the adapter, and still
 * re-applies it. This port simply does not use that capability, because
 * this unit needs the whole queue.
 *
 * ══════════════════════════════════════════════════════════════════════
 * AND THE PORT HAS NO FILTER PARAMETER, SO IT CANNOT BE MISUSED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A port that offered `read(filter?)` would invite the next implementer to
 * pass the filter through — and to reintroduce the defect above. The port
 * says exactly what this unit needs, and the filter lives where it can be
 * applied safely.
 */
import type { BatchQueueReadOutcome } from '../../../005-orgatex-integration/domain/services/batch-queue-reader.js';

/**
 * "Give me the released queue."
 *
 * The station's own question, expressed over unit 005's reader.
 */
export interface BatchQueueSource {
  /**
   * Read the **whole** released queue.
   *
   * @returns The reader's outcome. A failure is **returned**, not thrown —
   *          an unreachable MES is a normal condition (BRD FR-20).
   */
  read(): Promise<BatchQueueReadOutcome>;
}
