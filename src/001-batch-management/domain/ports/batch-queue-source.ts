/**
 * BatchQueueSource — the seam THIS unit reads the queue through.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PORT BELONGS TO THE CONSUMER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit 005 owns `OrgatexAdapter` — the seam with the MES. This port is
 * declared **here**, in the unit that consumes it, and it is satisfied by
 * unit 005's `BatchQueueReader`.
 *
 * Why not simply import that class? Because then unit 001 would depend on
 * unit 005's **implementation**, and unit 005's next refactor would ripple
 * into a unit that has no reason to know about it. Declaring the port here
 * means:
 *
 * - the dependency runs **inward**, from the application layer to a port
 *   this unit owns;
 * - the composition root binds the two, in one place;
 * - a test can bind a **controlled source** that returns a specific
 *   failure, with no MES, no database and no socket.
 *
 * This is the same hexagonal shape the codebase already uses — unit 004's
 * `ScaleAdapter`, unit 008's `SecretHasher`, unit 005's `OrgatexAdapter`.
 *
 * THE PORT TAKES NO FILTER
 * -----------------------
 * Filtering is bolt 009's story (`002-filter-batch-queue-by-status`). The
 * port grows a parameter when that story lands, and not before (ADR-028).
 */
import type { BatchQueueReadOutcome } from '../../../005-orgatex-integration/domain/services/batch-queue-reader.js';

/**
 * "Give me the released queue."
 *
 * The station's own question, expressed over unit 005's reader.
 */
export interface BatchQueueSource {
  /**
   * Read the released queue.
   *
   * @returns The reader's outcome. A failure is **returned**, not thrown —
   *          an unreachable MES is a normal condition (BRD FR-20).
   */
  read(): Promise<BatchQueueReadOutcome>;
}
