/**
 * BatchSummaryController — the batch's completion and its summary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SUMMARY IS COMPUTED, NOT STORED — AND THE CLIENT SUPPLIES NONE
 * OF ITS FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `GET  /api/batch/:batchId/summary` — the summary.
 * - `POST /api/batch/:batchId/complete` — complete the batch.
 *
 * **There is no field for the total, the verdict, the operator, the
 * elapsed time or the write-back's state.** The client cannot assert a
 * total or claim a batch was within tolerance — every one of those is
 * computed from the immutable records.
 *
 * **And the completion is idempotent**: a retry after an ambiguous
 * failure must not double-post (BRD IR-08, C-14). The idempotency is
 * unit 005's ledger, and this bolt does not re-check it.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WeighingStationModule } from '../../infrastructure/composition-root.js';

export const BATCH_NOT_COMPLETE = 'BATCH_NOT_COMPLETE';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

const batchIdSchema = z.string().trim().min(1).max(64);

export function createBatchSummaryRouter(
  station: WeighingStationModule,
): Router {
  const router = Router();

  /**
   * GET /api/batch/:batchId/summary — the summary.
   *
   * 200 — the summary, or `summary: null` when the batch is not complete.
   * 401 — no operator session.
   */
  router.get('/:batchId/summary', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = batchIdSchema.safeParse(req.params['batchId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await station.completeBatch.execute(parsed.data);

    if (outcome.kind !== 'COMPLETED') {
      // The batch is not complete — so there is no summary. And "not
      // complete" is a **state**, not an error.
      res.status(200).json({ summary: null });
      return;
    }

    res.status(200).json({ summary: serialiseSummary(outcome.summary) });
  });

  /**
   * POST /api/batch/:batchId/complete — complete the batch.
   *
   * 200 — the batch is complete, and the summary is here.
   * 409 — the batch is not complete.
   * 401 — no operator session.
   */
  router.post('/:batchId/complete', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = batchIdSchema.safeParse(req.params['batchId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await station.completeBatch.execute(parsed.data);

    if (outcome.kind === 'COMPLETED') {
      res.status(200).json({ summary: serialiseSummary(outcome.summary) });
      return;
    }

    if (outcome.kind === 'NOT_COMPLETE') {
      res.status(409).json({ error: BATCH_NOT_COMPLETE });
      return;
    }

    // There is no session, or it is not this batch's.
    res.status(404).json({ error: 'BATCH_NOT_FOUND' });
  });

  return router;
}

/**
 * Serialise the summary.
 *
 * **Every quantity is a STRING** — the total is a fixed-point decimal
 * string, never a float (BRD NFR-16, C-11).
 */
function serialiseSummary(summary: {
  readonly batchId: string;
  readonly sessionId: string;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly elapsedSeconds: number;
  readonly operatorId: string;
  readonly totalDispensed: { toJSON(): string; readonly unit: string };
  readonly allWithinTolerance: string;
  readonly writeBack: string;
  readonly writeBackConfirmedAt: Date | null;
  readonly releasedForTransport: boolean;
  readonly targetMachine: string;
}): unknown {
  return {
    batchId: summary.batchId,
    sessionId: summary.sessionId,
    componentsWeighed: summary.completedCount,
    componentCount: summary.totalCount,
    elapsedSeconds: summary.elapsedSeconds,
    operatorId: summary.operatorId,
    totalDispensed: summary.totalDispensed.toJSON(),
    unit: summary.totalDispensed.unit,
    allWithinTolerance: summary.allWithinTolerance,
    writeBack: summary.writeBack,
    writeBackConfirmedAt:
      summary.writeBackConfirmedAt === null
        ? null
        : summary.writeBackConfirmedAt.toISOString(),
    releasedForTransport: summary.releasedForTransport,
    targetMachine: summary.targetMachine,
  };
}
