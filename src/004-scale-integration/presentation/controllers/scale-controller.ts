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
import { ComponentId } from '../../domain/value-objects/component-id.js';
import type { Instant } from '../../domain/value-objects/instant.js';
import type { ScaleModule } from '../../infrastructure/composition-root.js';
import { DummyScaleAdapter } from '../../infrastructure/adapters/dummy-scale-adapter.js';
import {
  scaleIdSchema,
  linkControlSchema,
  dispenseControlSchema,
  tareRequestSchema,
  selectionRequestSchema,
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
        // Whether the device is the training dummy — the terminal shows its
        // training controls only for one, never for a real indicator.
        source:
          scales.adapters.get(device.id.value) instanceof DummyScaleAdapter
            ? 'DUMMY'
            : 'DEVICE',
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

  /**
   * GET /api/scales/:scaleId/tare — the tare in force.
   *
   * OPEN, like the other read endpoints (ADR-013): a scale's tare is
   * physically visible at the station.
   *
   * The `tare` field is `null` when NO TARE IS IN FORCE — which is a
   * different fact from "a tare of exactly zero" (S-12). The response
   * mirrors the domain's discriminated union rather than flattening it.
   */
  router.get('/:scaleId/tare', (req: Request, res: Response) => {
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

    res.status(200).json({
      scaleId: scaleId.value,
      tare: serialiseTare(device.tareState),
    });
  });

  /**
   * POST /api/scales/:scaleId/tare — apply a tare.
   *
   * REQUIRES AN OPERATOR SESSION (ADR-013). The tare MOVES THE DEVICE'S
   * ZERO REFERENCE — it changes what every subsequent reading means — so
   * it is a write. It does NOT require a SUPERVISOR, because a tare
   * authorises nothing.
   *
   * 202 — accepted. The tare is applied and the device's state reflects
   *       it from the next reading onward.
   * 409 — refused. The body names the reason and STATES THAT THE PREVIOUS
   *       TARE REMAINS IN FORCE (S-14). A caller that assumed the tare
   *       had been applied would record a quantity against a device that
   *       is not zeroed against that container.
   */
  router.post('/:scaleId/tare', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }
    const parsedBody = tareRequestSchema.safeParse(req.body);
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

    // The value's unit is NOT obeyed — it is converted into the DEVICE's
    // own unit inside the registry. A request claiming "kg" against a
    // gram-reporting device is converted, not obeyed.
    const outcome = scales.registry.applyTare(
      scaleId,
      WeightValue.of(parsedBody.data.tareValue, parsedBody.data.unit),
      parsedBody.data.source,
    );

    if (outcome.kind === 'REFUSED') {
      res.status(409).json({
        error: 'TARE_REFUSED',
        reason: outcome.reason,
        previousTareRetained: true,
      });
      return;
    }

    res.status(202).json({ tare: serialiseTare(outcome.state) });
  });

  /**
   * POST /api/scales/:scaleId/re-tare — zero the scale against what is on
   * the platform now (the prototype's F2).
   *
   * REQUIRES AN OPERATOR SESSION. The tare value is the device's own gross
   * reading, so the client sends no weight and does no arithmetic. It goes
   * through the registry's normal tare path, so the gate and the refusals
   * are the same as an explicit tare.
   *
   * 202 — the tare applied. 404 — no such scale, or the device cannot
   *       report a gross weight (only the training dummy can, today).
   * 409 — the tare was refused.
   */
  router.post('/:scaleId/re-tare', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    const adapter = scales.adapters.get(scaleId.value);
    if (
      scales.registry.get(scaleId) === null ||
      !(adapter instanceof DummyScaleAdapter)
    ) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    const outcome = scales.registry.applyTare(
      scaleId,
      adapter.grossWeight(),
      'WEIGHED_EMPTY_CONTAINER',
    );

    if (outcome.kind === 'REFUSED') {
      res.status(409).json({
        error: 'TARE_REFUSED',
        reason: outcome.reason,
        previousTareRetained: true,
      });
      return;
    }

    res.status(202).json({ tare: serialiseTare(outcome.state) });
  });

  /**
   * POST /api/scales/select — the automatic selection rule.
   *
   * REQUIRES AN OPERATOR SESSION (ADR-013). The selection is a decision
   * about the station's state, so it is a write.
   *
   * 200 — with EITHER outcome. The selection succeeded, or no device can
   *       weigh this target. NEITHER IS AN ERROR: a 40 kg target on a
   *       32 kg floor scale is a legitimate answer to a legitimate
   *       question, and a 4xx would make the caller treat a normal
   *       business outcome as a failure (ADR-018).
   */
  router.post('/select', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const parsedBody = selectionRequestSchema.safeParse(req.body);
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

    const outcome = scales.registry.selectScale(
      ComponentId.create(parsedBody.data.componentId),
      WeightValue.of(parsedBody.data.target, parsedBody.data.unit),
      parsedBody.data.demandedClass,
    );

    if (outcome.kind === 'NO_DEVICE_CAN_WEIGH') {
      res.status(200).json({
        selected: false,
        target: outcome.target.toJSON(),
        maximumCapacity: outcome.maximumCapacity.toJSON(),
        unit: outcome.target.unit,
        demandedClass: outcome.demandedClass,
      });
      return;
    }

    const selection = outcome.selection;
    res.status(200).json({
      selected: true,
      scaleId: selection.scaleId.value,
      componentId: selection.componentId.value,
      selectedAt: selection.selectedAt.toDate().toISOString(),
      reason: selection.reason,
      scaleClass: selection.scaleClass,
      capacity: selection.capacity.toJSON(),
      unit: selection.capacity.unit,
    });
  });

  return router;
}

/**
 * Serialise a tare for the wire.
 *
 * The value is a JSON STRING, never a number (ADR-008), and the unit
 * travels with it.
 */
function serialiseTare(tare: {
  readonly tareValue: { readonly text: string; readonly unit: string };
  readonly appliedAt: Instant;
  readonly source: string;
  readonly appliedBy: string;
} | null): unknown {
  if (tare === null) return null;
  return {
    value: tare.tareValue.text,
    unit: tare.tareValue.unit,
    appliedAt: tare.appliedAt.toDate().toISOString(),
    source: tare.source,
    appliedBy: tare.appliedBy,
  };
}
