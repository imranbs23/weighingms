/**
 * SyncQueueEntryState — the two states a queued consumption can be in.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO `DELIVERED` STATE, AND ITS ABSENCE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three candidates were considered, and the third was rejected:
 *
 * - `PENDING` — queued; the worker will retry it on the backoff.
 * - `FAILED`  — the last attempt failed permanently under the configured
 *               disposition; it is visible and re-drivable, but the worker
 *               will not retry it on its own.
 * - `DELIVERED` — **rejected**.
 *
 * A delivered entry is **not in the queue**. It has been removed, and the
 * *posting* says `ACCEPTED` — bolt 006's record, guarded by the ledger's
 * PRIMARY KEY (ADR-023).
 *
 * A `DELIVERED` row would be a **second source of truth** about whether a
 * consumption landed. A queue row saying `DELIVERED` and a posting row
 * saying `QUEUED` would be a silent wrong number waiting to happen.
 *
 * So the queue entry's state answers *"has this failed?"* and the
 * posting's state answers *"did it land?"* — two different questions,
 * two different records.
 *
 * `FAILED` IS NOT "GIVEN UP ON"
 * -----------------------------
 * It is "the automatic path has stopped and a human is now the
 * mechanism". The entry is never silently discarded (BRD FR-20, FR-33).
 */
export type SyncQueueEntryState = 'PENDING' | 'FAILED';

export const SYNC_QUEUE_ENTRY_STATES: readonly SyncQueueEntryState[] = [
  'PENDING',
  'FAILED',
];

export function isSyncQueueEntryState(
  value: unknown,
): value is SyncQueueEntryState {
  return (
    typeof value === 'string' &&
    (SYNC_QUEUE_ENTRY_STATES as readonly string[]).includes(value)
  );
}
