/**
 * ScaleController — the HTTP boundary for the scale unit.
 *
 * ADR-013: the READ endpoints are not session-guarded — a scale's
 * weight and calibration state are physically visible to anyone at the
 * station, and the UI needs the status strip before anyone signs in. The
 * WRITE endpoints (the training controls) require an operator session,
 * because they change what the operator is shown.
 *
 * WHY THE GATE IS NOT AN ERROR
 * -----------------------------
 * `GET /can-weigh` returns **200** with `{ allowed: false, reason }` when
 * the weighing is blocked. The gate is a QUESTION WITH AN ANSWER, and the
 * answer is "no, and here is why". Returning 403 would make a normal,
 * expected device state look like a failure — and the story requires the
 * reason to be NAMED, which an opaque error body would defeat.
 */
import { Router, type Request, type Response } from 'express';
import { ScaleId } from '../../domain/value-objects/scale-id.js';
import { WeightValue } from '../../domain/value-objects/weight-value.js';
import type { ScaleModule } from '../../infrastructure/composition-root.js';
import { DummyScaleAdapter } from '../../infrastructure/adapters/dummy-scale-adapter.js';
import {
  scaleIdSchema,
  linkControlSchema,
  dispenseControlSchema,
} from '../schemas/scale-schemas.js';

export const SCALE_NOT_FOUND = 'SCALE_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export function createScaleRouter(scales: ScaleModule): Router {
  const router = Router();

  /** GET /api/scales — the device list. */
  router.get('/', (_req: Request, res: Response) => {
    const devices = scales.registry.list();
    res.status(200).json({
      scales: devices.map((device) => ({
        scaleId: device.id.value,
        label: device.label,
        class: device.capability.scaleClass,
        capacity: device.capability.capacity.toJSON(),
        resolution: device.capability.resolution.toJSON(),
        unit: device.capability.capacity.unit,
        status: device.status,
        link: device.linkState,
      })),
    });
  });

  /** GET /api/scales/:scaleId/status — the status view. */
  router.get('/:scaleId/status', (req: Request, res: Response) => {
    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    const device = scales.registry.get(scaleId);
    if (device === null) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    const verdict = scales.registry.canWeigh(scaleId);
    const calibration = device.calibrationState;

    res.status(200).json({
      scaleId: device.id.value,
      label: device.label,
      class: device.capability.scaleClass,
      capacity: device.capability.capacity.toJSON(),
      resolution: device.capability.resolution.toJSON(),
      unit: device.capability.capacity.unit,
      // The operator-facing axis: exactly one value.
      status: device.status,
      // The internal axis, exposed so "went silent" and "never responded"
      // are distinguishable in the evidence (ADR-011).
      link: device.linkState,
      calibration: {
        state: calibration.kind,
        expiresAt:
          calibration.kind === 'IN_CALIBRATION'
            ? calibration.expiresAt.toISOString()
            : null,
      },
      lastReadingAt:
        device.lastAcceptedReading?.receivedAt.toISOString() ?? null,
      lastSequence: device.lastSequence?.value ?? null,
      canWeigh: { allowed: verdict.allowed, reason: verdict.reason },
    });
  });

  /**
   * GET /api/scales/:scaleId/can-weigh — the weighing gate.
   *
   * 200 with `{ allowed: false, reason }` when blocked. The gate is a
   * question with an answer, not a failure.
   */
  router.get('/:scaleId/can-weigh', (req: Request, res: Response) => {
    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    if (scales.registry.get(scaleId) === null) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    const verdict = scales.registry.canWeigh(scaleId);
    res.status(200).json({
      scaleId: scaleId.value,
      allowed: verdict.allowed,
      reason: verdict.reason,
      status: scales.registry.get(scaleId)?.status ?? 'DISCONNECTED',
    });
  });

  /**
   * POST /api/scales/:scaleId/link — TRAINING CONTROL.
   *
   * Makes a scale go silent so the disconnection handling is demonstrable
   * in the running product. Requires an operator session (ADR-013).
   */
  router.post('/:scaleId/link', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }
    const parsedBody = linkControlSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsedBody.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    if (scales.registry.get(scaleId) === null) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    scales.registry.forceLink(scaleId, parsedBody.data.state);
    res.status(202).json({ scaleId: scaleId.value, state: parsedBody.data.state });
  });

  /**
   * POST /api/scales/:scaleId/dispense — TRAINING CONTROL.
   *
   * Drives the dispersion ramp. Requires an operator session (ADR-013).
   */
  router.post('/:scaleId/dispense', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }
    const parsedBody = dispenseControlSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsedBody.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    const adapter = scales.adapters.get(scaleId.value);
    if (!(adapter instanceof DummyScaleAdapter)) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    const unit = scales.registry.get(scaleId)?.capability.capacity.unit ?? 'g';
    adapter.startDispense(
      WeightValue.of(parsedBody.data.target, unit),
      WeightValue.of(parsedBody.data.tolerance, unit),
      parsedBody.data.landing,
    );

    res.status(202).json({
      scaleId: scaleId.value,
      programme: parsedBody.data.landing,
    });
  });

  return router;
}
