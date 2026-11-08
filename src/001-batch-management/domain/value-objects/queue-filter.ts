/**
 * BatchQueueFilter — the operator's narrowing of the queue.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A VIEW. NEVER A GATE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The filter narrows what the operator **sees**. It does not decide what
 * may be **worked** — the story is explicit about that:
 *
 * > "A scan resolves to a batch in `RELEASED` status that is not in the
 * > currently displayed (filtered) queue → the selection succeeds, because
 * > eligibility is governed by status, not by the current filter; the queue
 * > filter is a view concern only."
 *
 * So the selection path reads the queue **without** a filter, and the
 * filter is applied only to what is published.
 *
 * ONE STATUS, OR NONE
 * -------------------
 * The filter holds **one** status, or nothing. It is not a set: a filter
 * that could hold several statuses would be a different product decision —
 * "show me everything released *or* queued" is a query the operator did not
 * ask for.
 *
 * The absence is `null`, **never** an empty string and never a wildcard.
 * Those would be three spellings of "no filter", and a client that sent one
 * of them would have to be interpreted. "The filter is off" is not a status
 * the MES knows.
 */
import type { BatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';

/**
 * The filter over the queue.
 *
 * `null` means **no filter** — the operator's "All".
 */
export type QueueFilter = BatchWeighingStatus | null;

/**
 * The filter's option set — the statuses present in a queue.
 *
 * A distinct list, in the order the statuses appear in the queue's rows.
 * **Not** the MES's vocabulary: a status that is not in the queue is a
 * filter that will match nothing (ADR-030).
 */
export type FilterableStatuses = readonly BatchWeighingStatus[];
