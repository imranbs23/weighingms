/**
 * BatchQueueController — the station's own queue endpoint.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATION'S QUEUE, NOT THE MES's.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `/api/orgatex/batches` is unit 005's surface — *"what did the MES say?"*
 * This one answers *"what work is on offer at this station?"*, and by bolt
 * 009 it carries the selection and by unit 002 the recipe context. The two
 * are allowed to diverge (ADR-028).
 *
 * WHY NOT `/api/batches/queue`
 * ---------------------------
 * **`/api/batches` is the Dummy MES's prefix**, and the Dummy's router is
 * mounted at `/api` and owns `/api/batches/:batchId`. A queue route at
 * `/api/batches/queue` would be **silently captured** by that route and
 * answered with a batch-not-found — a failure that looks like a missing
 * batch rather than a routing mistake.
 *
 * `/api/batch-queue` cannot collide: no router in this product owns a route
 * that begins with `/batch-queue`.
 *
 * THE FAILURE IS DISTINGUISHABLE, AND THAT IS THE POINT
 * ----------------------------------------------------
 * An unreachable MES and an empty release list both produce zero rows on
 * screen. If the failure were silent, the operator could not tell "there
 * is no work" from "we cannot see the work" — and would start looking for
 * the wrong problem.
 *
 * So:
 *   - an empty queue is a **200** with `batches: []` and a receipt time;
 *   - an unreachable MES is a **503** whose body has **no `batches` key
 *     at all** — not an empty array.
 *
 * A client that renders whatever is under `batches` is therefore forced to
 * look at the status code to know it is in the error state.
 *
 * NO PROSE CROSSES THIS BOUNDARY
 * ------------------------------
 * The body carries **codes** and data, never a sentence (BRD NFR-11,
 * FR-22). The missing-fabric-description case is `null`, and the text the
 * operator sees in its place belongs to the UI.
 */
import { Router, type Request, type Response } from 'express';
import type { BatchManagementModule } from '../../infrastructure/composition-root.js';
import type { SnapshotFreshness } from '../../../005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { isBatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import type { BatchWeighingStatus } from '../../../005-orgatex-integration/domain/value-objects/batch-weighing-status.js';

export const BATCH_QUEUE_UNAVAILABLE = 'BATCH_QUEUE_UNAVAILABLE';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export function createBatchQueueRouter(batches: BatchManagementModule): Router {
  const router = Router();

  /**
   * GET /api/batch-queue — the released batch queue.
   *
   * 200 — the queue, with its receipt time, its source and its freshness.
   * 400 — the `status` parameter is not a status the MES knows.
   * 401 — no operator session.
   * 503 — there is no queue to show.
   *
   * ADR-020: the endpoint requires an operator session. The MES's queue is
   * OrgaTEX's production schedule and is not physically visible at the
   * station, so ADR-013's exemption does not apply. A supervisor is NOT
   * required: reading authorises nothing.
   */
  router.get('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    // THE FILTER IS VALIDATED, NOT GUESSED.
    //
    // An absent parameter means "All" — and that is the ONLY way to say
    // "All". An unknown status is a `400`, because silently ignoring it
    // would show the operator rows they did not ask for and tell them
    // nothing (ADR-030).
    const raw = req.query['status'];
    const filter = parseFilter(raw);

    if (filter === undefined) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: [
          {
            path: 'status',
            message: 'must be one of QUEUED, RELEASED, WEIGHING, WEIGHED, CANCELLED',
          },
        ],
      });
      return;
    }

    const availability = await batches.retrieveBatchQueue.execute(filter);

    if (availability.kind === 'UNAVAILABLE') {
      // The reason code and nothing else. The diagnostic went to the log
      // (BRD IR-09) — a client that received the MES's own error text
      // would be rendering text that was never written for it.
      res.status(503).json({
        error: BATCH_QUEUE_UNAVAILABLE,
        reason: availability.reason,
      });
      return;
    }

    const queue = availability.queue;

    res.status(200).json({
      batches: queue.batches.map((batch) => ({
        batchId: batch.batchId.value,
        orderRef: batch.orderRef.value,
        machineRef: batch.machineRef.value,
        // `null` when the MES gave none — the UI renders its own
        // placeholder. Never a string, so the two cases cannot be
        // confused.
        fabricDescription: batch.fabricDescription,
        shadeCode: batch.shadeCode.value,
        componentCount: batch.componentCount,
        weighingStatus: batch.weighingStatus,
      })),
      // The queue's receipt time — UNCHANGED by the filter. The filtered
      // view is a view of the same queue, so the operator can still see
      // how old the underlying data is.
      receivedAt: queue.receivedAt.toISOString(),
      source: queue.source,
      freshness: serialiseFreshness(queue.freshness),
      // The filter that was applied. `null` means "All".
      filter: filter === null ? null : { status: filter },
      // The statuses the operator may filter TO — the statuses present in
      // the queue, not the MES's whole vocabulary (ADR-030).
      statuses: availability.statuses,
    });
  });

  return router;
}

/**
 * Parse the `status` query parameter.
 *
 * @returns The status, `null` for "All" (the parameter was absent), or
 *          `undefined` when the parameter was present but is not a status
 *          the MES knows.
 */
function parseFilter(raw: unknown): BatchWeighingStatus | null | undefined {
  // ABSENT means "All". The empty string is NOT "All" — it is a client
  // that sent a status and it was not one.
  if (raw === undefined) return null;

  // A repeated parameter arrives as an array. It is not a status, so it is
  // refused — a filter has exactly one status.
  if (typeof raw !== 'string') return undefined;

  return isBatchWeighingStatus(raw) ? raw : undefined;
}

/**
 * Serialise the freshness marker.
 *
 * It is **always present** — a consumer must never have to infer whether a
 * queue is stale from its absence.
 */
function serialiseFreshness(freshness: SnapshotFreshness): unknown {
  if (freshness.kind === 'CURRENT') {
    return { kind: 'CURRENT' };
  }
  // A STALE freshness ALWAYS carries its age — the type says so, so the
  // projection cannot silently report zero for an unknown age.
  return { kind: 'STALE', ageMs: freshness.ageMs };
}
