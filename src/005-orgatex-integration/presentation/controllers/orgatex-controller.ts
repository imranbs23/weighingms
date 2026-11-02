/**
 * OrgatexController — the product's own HTTP boundary for the MES seam.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THESE ARE WEIGHINGMS'S ENDPOINTS, NOT THE MES'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * They expose **domain snapshots**, not the Dummy MES's payload shape. That
 * separation is the whole point of IR-07: if this API mirrored the Dummy's,
 * replacing the Dummy with the real MES would mean changing every consumer
 * of unit `005`.
 *
 * ADR-020: BOTH endpoints require an **operator session**. The MES's queue
 * is not physically visible at the station — it is OrgaTEX's production
 * schedule — so ADR-013's "physically visible" exemption does not apply.
 * A supervisor is NOT required: reading authorises nothing.
 *
 * EVERY QUANTITY IS A DECIMAL STRING (ADR-008). A JSON number is a float,
 * and the tolerance boundary is where that error would bite.
 */
import { Router, type Request, type Response } from 'express';
import { BatchId } from '../../domain/value-objects/identifiers.js';
import { ComponentId, LotNumber, OperatorReference } from '../../domain/value-objects/identifiers.js';
import { isBatchWeighingStatus } from '../../domain/value-objects/batch-weighing-status.js';
import type { BatchWeighingStatus } from '../../domain/value-objects/batch-weighing-status.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { OrgatexModule } from '../../infrastructure/composition-root.js';
import {
  batchStatusWriteSchema,
  consumptionPostingSchema,
} from '../schemas/orgatex-write-schemas.js';

export const ORGATEX_UNAVAILABLE = 'ORGATEX_UNAVAILABLE';
export const BATCH_NOT_FOUND = 'BATCH_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const POSTINGS_UNRESOLVED = 'POSTINGS_UNRESOLVED';
export const POSTING_REJECTED = 'POSTING_REJECTED';

export function createOrgatexRouter(orgatex: OrgatexModule): Router {
  const router = Router();

  /**
   * GET /api/orgatex/batches — the released batch queue.
   *
   * 200 — the queue, with its age and its source.
   * 503 — the MES could not be reached and there is nothing to serve.
   *
   * A `DEGRADED` read is still a **200**, with `freshness.kind` saying
   * `STALE` and `ageMs` saying how stale. It is not a 503: the station
   * served the operator's work list, marked with its age — which is
   * exactly what FR-20 asks for.
   */
  router.get('/batches', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsedFilter = parseFilter(req.query['status']);
    if (parsedFilter === 'INVALID') {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await orgatex.queueReader.read(parsedFilter ?? undefined);

    if (outcome.kind === 'FAILED') {
      res.status(503).json({
        error: ORGATEX_UNAVAILABLE,
        reason: outcome.reason,
      });
      return;
    }

    res.status(200).json({
      batches: outcome.snapshot.batches.map((batch) => ({
        batchId: batch.batchId.value,
        orderRef: batch.orderRef.value,
        machineRef: batch.machineRef.value,
        fabricDescription: batch.fabricDescription,
        shadeCode: batch.shadeCode.value,
        componentCount: batch.componentCount,
        weighingStatus: batch.weighingStatus,
        eligibility:
          batch.eligibility.kind === 'ELIGIBLE'
            ? { kind: 'ELIGIBLE' }
            : {
                kind: 'NOT_ELIGIBLE',
                reason: batch.eligibility.reason,
              },
      })),
      receivedAt: outcome.snapshot.receivedAt.toDate().toISOString(),
      source: outcome.snapshot.source,
      freshness: serialiseFreshness(outcome.freshness),
    });
  });

  /**
   * GET /api/orgatex/batches/:batchId/recipe — a batch's recipe.
   *
   * 200 — the recipe, with its age and its source.
   * 404 — the MES was REACHED and has no such batch.
   * 503 — the MES could not be reached and there is nothing to serve.
   */
  router.get('/batches/:batchId/recipe', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const rawId = req.params['batchId'];
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    let batchId: BatchId;
    try {
      batchId = BatchId.create(rawId);
    } catch {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await orgatex.recipeReader.read(batchId);

    if (outcome.kind === 'NOT_FOUND') {
      res.status(404).json({ error: BATCH_NOT_FOUND });
      return;
    }

    if (outcome.kind === 'FAILED') {
      res.status(503).json({
        error: ORGATEX_UNAVAILABLE,
        reason: outcome.reason,
      });
      return;
    }

    res.status(200).json({
      batchId: outcome.snapshot.batchId.value,
      shadeCode: outcome.snapshot.shadeCode.value,
      components: outcome.snapshot.components.map((component) => ({
        sequence: component.sequence,
        componentId: component.componentId.value,
        dyestuffCode: component.dyestuffCode.value,
        target: component.target.toJSON(),
        unit: component.target.unit,
        tolerance:
          component.tolerance === null
            ? null
            : {
                min: component.tolerance.min.toJSON(),
                max: component.tolerance.max.toJSON(),
              },
        scaleClass: component.scaleClass,
      })),
      receivedAt: outcome.snapshot.receivedAt.toDate().toISOString(),
      source: outcome.snapshot.source,
      freshness: serialiseFreshness(outcome.freshness),
    });
  });

  /**
   * POST /api/orgatex/batches/:batchId/consumption — post one consumption.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE STATUS CODES ARE NOT INTERCHANGEABLE.
   * ══════════════════════════════════════════════════════════════════
   *
   * - **201** — the MES accepted it. The consumption is posted.
   * - **200** — a **duplicate**. The same weighing was already posted.
   *   A duplicate is NOT an error: the caller asked for something that had
   *   already happened, and the answer is "it is done". A `409` would
   *   suggest the caller should do something about it — and there is
   *   nothing to do.
   * - **201** with `state: 'QUEUED'` — the MES could not be reached. The
   *   posting is pending, NOT posted. The `201` is deliberate: the
   *   request WAS accepted for delivery. A `503` would tell the operator
   *   "try again", and trying again is exactly what must not happen —
   *   the key makes a retry safe, but a second queue entry would not be.
   * - **422** — the MES **reached** it and **refused**. A definitive
   *   answer, and the reason is a **code**.
   *
   * THE OPERATOR COMES FROM THE SESSION
   * -----------------------------------
   * The body has no operator field. See `orgatex-write-schemas.ts`.
   */
  router.post(
    '/batches/:batchId/consumption',
    async (req: Request, res: Response) => {
      if (req.currentOperator === undefined) {
        res.status(401).json({ error: UNAUTHENTICATED });
        return;
      }

      const rawId = req.params['batchId'];
      if (typeof rawId !== 'string' || rawId.trim().length === 0) {
        res.status(400).json({ error: VALIDATION_ERROR });
        return;
      }

      let batchId: BatchId;
      try {
        batchId = BatchId.create(rawId);
      } catch {
        res.status(400).json({ error: VALIDATION_ERROR });
        return;
      }

      const parsedBody = consumptionPostingSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: VALIDATION_ERROR });
        return;
      }

      const outcome = await orgatex.postingService.post({
        batchId,
        componentId: ComponentId.create(parsedBody.data.componentId),
        actualQuantity: WeightValue.of(
          parsedBody.data.actualQuantity,
          parsedBody.data.unit,
        ),
        lotNumber: LotNumber.create(parsedBody.data.lotNumber),
        // From the SESSION. Never from the body.
        operatorId: OperatorReference.create(req.currentOperator.id.value),
        weighedAt: Instant.of(new Date(parsedBody.data.weighedAt)),
      });

      switch (outcome.kind) {
        case 'ACCEPTED':
          res.status(201).json({
            state: 'ACCEPTED',
            postingId: outcome.posting.id.value,
            batchId: outcome.posting.batchId.value,
            componentId: outcome.posting.componentId.value,
          });
          return;

        case 'QUEUED':
          res.status(201).json({
            state: 'QUEUED',
            pending: true,
            postingId: outcome.posting.id.value,
            batchId: outcome.posting.batchId.value,
            componentId: outcome.posting.componentId.value,
          });
          return;

        case 'REJECTED':
          res.status(422).json({
            error: POSTING_REJECTED,
            state: 'REJECTED',
            postingId: outcome.posting.id.value,
            reason: outcome.reason.code,
            detail: outcome.reason.detail,
          });
          return;

        case 'DUPLICATE':
          res.status(200).json({
            state: 'DUPLICATE',
            duplicate: true,
            postingId: outcome.posting.id.value,
            batchId: outcome.posting.batchId.value,
            componentId: outcome.posting.componentId.value,
          });
          return;
      }
    },
  );

  /**
   * POST /api/orgatex/batches/:batchId/status — advance the batch's
   * weighing status.
   *
   * - **200** — the MES took it.
   * - **201** with `state: 'QUEUED'` — the MES could not be reached.
   * - **409** — the batch's postings are **not all resolved**. The batch
   *   is not ready to be `WEIGHED`, and the count says how many are
   *   outstanding.
   * - **422** — the MES **reached** it and **refused**.
   */
  router.post('/batches/:batchId/status', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const rawId = req.params['batchId'];
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    let batchId: BatchId;
    try {
      batchId = BatchId.create(rawId);
    } catch {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const parsedBody = batchStatusWriteSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await orgatex.statusWriteService.advanceToWeighed(
      batchId,
      parsedBody.data.status,
    );

    switch (outcome.kind) {
      case 'WRITTEN':
        res.status(200).json({
          state: 'ACCEPTED',
          batchId: batchId.value,
          status: parsedBody.data.status,
        });
        return;

      case 'QUEUED':
        res.status(201).json({
          state: 'QUEUED',
          pending: true,
          batchId: batchId.value,
          status: parsedBody.data.status,
        });
        return;

      case 'POSTINGS_UNRESOLVED':
        res.status(409).json({
          error: POSTINGS_UNRESOLVED,
          unresolved: outcome.unresolved,
        });
        return;

      case 'REJECTED':
        res.status(422).json({
          error: POSTING_REJECTED,
          state: 'REJECTED',
          batchId: batchId.value,
          reason: outcome.reason.code,
          detail: outcome.reason.detail,
        });
        return;
    }
  });

  return router;
}

/**
 * Serialise the freshness marker.
 *
 * It is **always present** — a consumer must never have to infer whether
 * a snapshot is stale from its absence.
 */
function serialiseFreshness(freshness: {
  readonly kind: 'CURRENT' | 'STALE';
  readonly ageMs?: number;
}): unknown {
  if (freshness.kind === 'CURRENT') {
    return { kind: 'CURRENT' };
  }
  return { kind: 'STALE', ageMs: freshness.ageMs ?? 0 };
}

/**
 * Parse the optional status filter.
 *
 * `'INVALID'` is a sentinel rather than a thrown error, because a bad
 * query parameter is a **client** mistake — a `400`, not a `500`.
 */
function parseFilter(
  raw: unknown,
): 'INVALID' | BatchWeighingStatus | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') return 'INVALID';
  if (!isBatchWeighingStatus(raw)) return 'INVALID';
  return raw;
}
