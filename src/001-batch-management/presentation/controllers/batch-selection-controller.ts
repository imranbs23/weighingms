/**
 * BatchSelectionController — the selection's endpoints.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A WRITE, AND A READ OF A WRITE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `POST /api/selection` records the operator's choice of a batch, and
 * `GET /api/selection` reports the current one.
 *
 * WHY `/api/selection` AND NOT `/api/batch-queue/selection`
 * ---------------------------------------------------------
 * The selection is **not** a view of the queue. It is a record the station
 * made, and it outlives the queue: the queue is re-fetchable and may be
 * unreachable, and the selection is not.
 *
 * So it is a resource of its own, with its own path, and it does not live
 * under the queue's path — where a client would reasonably expect it to
 * disappear when the queue did.
 *
 * WHY A `409` FOR AN INELIGIBLE BATCH
 * -----------------------------------
 * A `403` means *"you are not allowed to do this"*. The operator **is**
 * allowed to select batches — the problem is that **this** batch is not
 * in a state where it can be worked, which is a **conflict with the
 * batch's current state**. `409 Conflict` is the status whose whole
 * meaning is *"your request is well-formed, and it conflicts with the
 * current state of the thing"*.
 *
 * A `403` would also be actively misleading: it reads as "you are not
 * authorised", and the operator's correct response to that is to ask a
 * supervisor for permission — when the actual cause is that the batch is
 * not released yet.
 *
 * WHY THE REASON IS A CODE
 * ------------------------
 * BRD NFR-11 and FR-22: the API emits **codes**, and the UI owns the
 * text. The refusal body carries the reason and nothing else, so the
 * operator is told *that* the batch cannot be worked and *why*, and the
 * wording is the UI's.
 *
 * AND WHY A REFUSAL IS NOT A SILENT NO-OP
 * -------------------------------------
 * A `201` with an empty body, or a `200` with `selected: false`, would
 * make the refusal indistinguishable from a success at the HTTP layer. The
 * operator would see the screen not change and would have no idea why.
 */
import { Router, type Request, type Response } from 'express';
import type { BatchManagementModule } from '../../infrastructure/composition-root.js';
import {
  batchSelectionSchema,
} from '../schemas/batch-selection-schemas.js';

export const SELECTION_REFUSED = 'SELECTION_REFUSED';
export const SCANNER_UNAVAILABLE = 'SCANNER_UNAVAILABLE';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export function createBatchSelectionRouter(
  batches: BatchManagementModule,
): Router {
  const router = Router();

  /**
   * GET /api/selection — the current selection.
   *
   * 200 — the selection, or `null` when nothing has been chosen yet.
   * 401 — no operator session.
   *
   * An empty selection is a **200 with `null`**, never a `404`. "Nobody has
   * chosen a batch yet" is a state, and it is the operator's **first**
   * render — so making it an error would put the UI's first paint on an
   * error path.
   */
  router.get('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const selection = await batches.selectBatch.current();

    res.status(200).json({
      selection: selection === null ? null : serialiseSelection(selection),
    });
  });

  /**
   * POST /api/selection — record the operator's choice.
   *
   * 201 — the selection was recorded.
   * 400 — the body is not a selection request.
   * 401 — no operator session.
   * 409 — the batch was recognised and may not be worked, or the code
   *       named nothing.
   * 503 — the scanner could not be read.
   *
   * The operator comes from the **session**. The body has no field for it
   * (ADR-005), and no field for the method either — the method is derived
   * from the request's shape (ADR-030).
   */
  router.post('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = batchSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: [
          {
            path: 'body',
            message: 'must carry exactly one of batchId or code',
          },
        ],
      });
      return;
    }

    const operatorId = req.currentOperator.id;

    // The method is DERIVED from the request's shape — a `code` came from
    // the scanner, a `batchId` came from a touched row. There is no path
    // that accepts a method from the client.
    const outcome =
      parsed.data.code !== undefined
        ? await batches.selectBatch.executeByScan(operatorId)
        : await batches.selectBatch.executeByTouch(
            parsed.data.batchId as string,
            operatorId,
          );

    switch (outcome.kind) {
      case 'SELECTED':
        res.status(201).json({ selection: serialiseSelection(outcome.selection) });
        return;

      case 'REFUSED':
        // The reason code and nothing else. The diagnostic went to the log.
        res.status(409).json({
          error: SELECTION_REFUSED,
          reason: outcome.refusal.reason,
        });
        return;

      case 'SCANNER_UNAVAILABLE':
        // The device is down. The operator is told the scanner is
        // unavailable and may fall back to touching the row (BRD FR-19).
        res.status(503).json({ error: SCANNER_UNAVAILABLE });
        return;
    }
  });

  return router;
}

/**
 * Serialise a selection for the wire.
 *
 * The operator's id, the batch's identity, the moment of the act and the
 * method. No prose, no diagnostic — and no field the client could have
 * influenced.
 */
function serialiseSelection(selection: {
  readonly batchId: { readonly value: string };
  readonly orderRef: { readonly value: string };
  readonly machineRef: { readonly value: string };
  readonly operatorId: { readonly value: string };
  readonly selectedAt: { toString(): string };
  readonly selectionMethod: string;
}): unknown {
  return {
    batchId: selection.batchId.value,
    orderRef: selection.orderRef.value,
    machineRef: selection.machineRef.value,
    operatorId: selection.operatorId.value,
    selectedAt: selection.selectedAt.toString(),
    selectionMethod: selection.selectionMethod,
  };
}
