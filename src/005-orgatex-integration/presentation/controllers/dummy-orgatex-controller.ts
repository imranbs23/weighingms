/**
 * The Dummy OrgaTEX's own HTTP router — the TRAINING ARTEFACT.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS NOT THE PRODUCT'S API. IT IS THE MES'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The workbook requires the Dummy OrgaTEX to exist as a real, independently
 * exercisable service:
 *
 * > "The training application needs at least: GET /api/batches,
 * > GET /api/batches/:batchId, GET /api/batches/:batchId/recipe,
 * > POST /api/batches/:batchId/consumption."
 *
 * > "Do not hard-code fake data directly into the UI. Use APIs." (Rule 5)
 *
 * So this router is mounted, and it serves the SAME world the adapter
 * holds (ADR-022). There is one copy of the data, so the router and the
 * adapter cannot drift.
 *
 * WHY IT IS OPEN
 * --------------
 * This router is the **external system**, standing in for OrgaTEX. The
 * product's own adapter would reach it without a WeighingMS session, so
 * requiring one here would be requiring the MES to know about WeighingMS's
 * identity system — which is exactly the coupling a real MES does not have.
 *
 * It is stated as a known property of the **training build**, not as a
 * recommendation: a real deployment removes this router entirely.
 */
import { Router, type Request, type Response } from 'express';
import type { DummyOrgatexWorld } from '../../infrastructure/adapters/dummy-orgatex-data.js';
import type { RawConsumption } from '../../domain/ports/orgatex-adapter.js';
import {
  rejectionControlSchema,
  releaseControlSchema,
} from '../schemas/orgatex-write-schemas.js';

export function createDummyOrgatexRouter(world: DummyOrgatexWorld): Router {
  const router = Router();

  /** GET /api/batches — the MES's queue. */
  router.get('/batches', (req: Request, res: Response) => {
    if (!world.isReachable) {
      res.status(503).json({ error: 'ORGATEX_UNAVAILABLE' });
      return;
    }

    const filter = req.query['status'];
    const queue = world.readQueue(typeof filter === 'string' ? filter : undefined);
    res.status(200).json(queue);
  });

  /** GET /api/batches/:batchId — the MES's batch detail. */
  router.get('/batches/:batchId', (req: Request, res: Response) => {
    if (!world.isReachable) {
      res.status(503).json({ error: 'ORGATEX_UNAVAILABLE' });
      return;
    }

    const batch = world.readBatch(String(req.params['batchId']));
    if (batch === null) {
      res.status(404).json({ error: 'BATCH_NOT_FOUND' });
      return;
    }

    res.status(200).json(batch);
  });

  /** GET /api/batches/:batchId/recipe — the MES's recipe. */
  router.get('/batches/:batchId/recipe', (req: Request, res: Response) => {
    if (!world.isReachable) {
      res.status(503).json({ error: 'ORGATEX_UNAVAILABLE' });
      return;
    }

    const recipe = world.readRecipe(String(req.params['batchId']));
    if (recipe === null) {
      res.status(404).json({ error: 'BATCH_NOT_FOUND' });
      return;
    }

    res.status(200).json(recipe);
  });

  /**
   * POST /api/batches/:batchId/consumption — the MES's own write endpoint.
   *
   * The workbook requires this one specifically:
   *
   * > "POST /api/batches/:batchId/consumption."
   *
   * ══════════════════════════════════════════════════════════════════
   * THE MES DOES NOT DEDUPLICATE.
   * ══════════════════════════════════════════════════════════════════
   *
   * It accepts every consumption it is given, key or no key. ADR-025
   * makes the **local** ledger the guarantee, and no claim is made that
   * the MES understands the key (Q-02). A Dummy that deduplicated would
   * hide the very failure the ledger exists to prevent.
   *
   * So this endpoint's behaviour is: accept, and record. If a posting is
   * ever sent twice, the Dummy will show both — which is how a failure
   * of the local guard becomes visible.
   */
  router.post('/batches/:batchId/consumption', (req: Request, res: Response) => {
    if (!world.isReachable) {
      res.status(503).json({ error: 'ORGATEX_UNAVAILABLE' });
      return;
    }

    const body = req.body as Partial<RawConsumption> | undefined;
    if (!isRawConsumption(body)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [{ path: 'body', message: 'is not a consumption record' }],
      });
      return;
    }

    if (String(req.params['batchId']) !== body.batchId) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [
          { path: 'batchId', message: 'does not match the path' },
        ],
      });
      return;
    }

    if (world.rejectsConsumption) {
      res.status(422).json({
        error: 'CONSUMPTION_REJECTED',
        reason: 'BATCH_NOT_POSTABLE',
        detail: 'The Dummy MES was told to refuse consumptions',
      });
      return;
    }

    world.postConsumption(body);
    res.status(201).json({ accepted: true, batchId: body.batchId });
  });

  /**
   * POST /api/batches/:batchId/status — the MES's own status endpoint.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE STATUS IS A LITERAL. NO OTHER FIELD IS WRITABLE.
   * ══════════════════════════════════════════════════════════════════
   *
   * Only `WEIGHED` may be written, and only the weighing status may be
   * changed (BRD IR-06, C-01). The endpoint takes a **status**, not a
   * batch, so there is no parameter through which another OrgaTEX batch
   * field could be altered.
   */
  router.post('/batches/:batchId/status', (req: Request, res: Response) => {
    if (!world.isReachable) {
      res.status(503).json({ error: 'ORGATEX_UNAVAILABLE' });
      return;
    }

    const body = req.body as { status?: unknown } | undefined;
    if (body?.status !== 'WEIGHED') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [{ path: 'status', message: 'must be WEIGHED' }],
      });
      return;
    }

    if (world.rejectsStatusWrite) {
      res.status(422).json({
        error: 'STATUS_REJECTED',
        reason: 'BATCH_NOT_POSTABLE',
        detail: 'The Dummy MES was told to refuse status writes',
      });
      return;
    }

    const written = world.writeBatchStatus(
      String(req.params['batchId']),
      body.status,
    );
    if (!written) {
      res.status(404).json({ error: 'BATCH_NOT_FOUND' });
      return;
    }

    res.status(200).json({ status: body.status });
  });

  /**
   * POST /api/orgatex/control — the TRAINING CONTROL.
   *
   * Makes the Dummy MES unreachable, so the `DEGRADED` and `OFFLINE`
   * paths are demonstrable in the **running product** rather than only in
   * a test. The scale unit has the same pattern (its link control), and
   * the reason is the same: BRD FR-20 is a requirement about the product
   * behaving, not about a test asserting it.
   *
   * It requires an operator session, because it changes what the station
   * will show — it is a write to the training world.
   */
  router.post('/orgatex/control', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const body = req.body as { state?: unknown };
    const requested = body?.state;

    if (requested !== 'REACHABLE' && requested !== 'UNREACHABLE') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [{ path: 'state', message: 'must be REACHABLE or UNREACHABLE' }],
      });
      return;
    }

    const previous = world.setReachable(requested === 'REACHABLE');
    res.status(200).json({
      state: requested,
      previousState: previous ? 'REACHABLE' : 'UNREACHABLE',
    });
  });

  /**
   * POST /api/orgatex/control/reject — the TRAINING CONTROL for
   * **refusals**.
   *
   * ══════════════════════════════════════════════════════════════════
   * A REFUSAL IS NOT AN OUTAGE. THEY ARE DIFFERENT CONTROLS.
   * ══════════════════════════════════════════════════════════════════
   *
   * The outage control above makes the MES **unreachable**, which leaves
   * a posting `QUEUED` — pending, not posted, not rejected. This control
   * makes the MES **reachable and refusing**, which is a definitive
   * answer: the posting's state becomes `REJECTED` and the reason is
   * retained (BRD IR-08).
   *
   * Two different outcomes, two different controls, so a training run can
   * demonstrate each on its own.
   */
  router.post('/orgatex/control/reject', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsed = rejectionControlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [{ path: 'body', message: 'is not a rejection control' }],
      });
      return;
    }

    const { reject, target } = parsed.data;
    if (target === 'CONSUMPTION' || target === 'BOTH') {
      world.setRejectsConsumption(reject);
    }
    if (target === 'STATUS' || target === 'BOTH') {
      world.setRejectsStatusWrite(reject);
    }

    res.status(200).json({
      reject,
      target,
      rejectsConsumption: world.rejectsConsumption,
      rejectsStatusWrite: world.rejectsStatusWrite,
    });
  });

  /**
   * POST /api/orgatex/control/release — the TRAINING CONTROL for
   * **releases**.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE MES RELEASES THE BATCH. THAT IS WHY THIS IS HERE.
   * ══════════════════════════════════════════════════════════════════
   *
   * BRD BR-03: *"The business must not permit weighing against a batch
   * OrgaTEX has not released."* So the release is the **MES's act**, and
   * the station's seam writes only `WEIGHED` (BRD IR-06, C-01).
   *
   * The seed world holds **no** `RELEASED` batch — `B-24187` is `WEIGHING`
   * and the other three are `QUEUED` — so the queue has no selectable row at
   * all, and the whole downstream flow cannot be demonstrated in the running
   * product.
   *
   * So this control releases a batch **in the MES's own world**, and the
   * station's own eligibility rule then permits the selection. The rule is
   * not bypassed and not relaxed: a released batch becomes selectable
   * because the MES says so, exactly as a real release would.
   *
   * It requires an operator session, because it changes what the station
   * will show — it is a write to the training world.
   */
  router.post('/orgatex/control/release', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsed = releaseControlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const released = world.setWeighingStatus(
      parsed.data.batchId,
      parsed.data.status,
    );
    if (!released) {
      res.status(404).json({ error: 'BATCH_NOT_FOUND' });
      return;
    }

    res.status(200).json({
      batchId: parsed.data.batchId,
      status: parsed.data.status,
    });
  });

  return router;
}

/**
 * Is this a consumption record the MES will accept?
 *
 * Every quantity is a **string** — the MES's own rule (ADR-008), and the
 * same rule the product's boundary enforces. A number is refused rather
 * than coerced: the MES would store a double, and the tolerance boundary
 * is where that error bites.
 */
function isRawConsumption(
  body: Partial<RawConsumption> | undefined,
): body is RawConsumption {
  if (body === undefined || body === null) return false;

  return (
    typeof body.batchId === 'string' &&
    typeof body.componentId === 'string' &&
    typeof body.actualQuantity === 'string' &&
    typeof body.unit === 'string' &&
    typeof body.lotNumber === 'string' &&
    typeof body.operatorId === 'string' &&
    typeof body.weighedAt === 'string' &&
    typeof body.idempotencyKey === 'string'
  );
}
