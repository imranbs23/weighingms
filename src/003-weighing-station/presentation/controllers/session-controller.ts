/**
 * SessionController — the weighing session's endpoints.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR NEVER CHOOSES THE SCALE. AND NEVER POSTS A WEIGHT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `POST /api/session/select` — select a component; the rule binds the
 *   scale.
 * - `GET  /api/session` — the session's current state.
 * - `GET  /api/session/weight` — the current weight and the still-to-weigh.
 *
 * **There is no endpoint that accepts a weight.** The weight comes from the
 * device, through unit `004`'s stream — a client that could post a weight
 * could post the weight it wanted (BRD BR-10).
 *
 * WHY A `409` FOR "NO DEVICE CAN WEIGH THIS"
 * ----------------------------------------
 * The question "which scale?" has been **answered correctly** — the
 * target exceeds every available capacity. That is a successful answer to
 * a well-formed question, not a malformed request, and the session does
 * **not** enter `WEIGHING`.
 *
 * So the `409` carries the **reason as data**: the target, the maximum
 * available capacity, and the demanded class. The operator is told why,
 * and the UI owns the wording (BRD NFR-11).
 *
 * NO PROSE CROSSES THIS BOUNDARY
 * ------------------------------
 * The body carries **codes** and data, never a sentence.
 */
import { Router, type Request, type Response } from 'express';
import type { WeighingStationModule } from '../../infrastructure/composition-root.js';
import type { WeighingSession } from '../../domain/entities/weighing-session.js';
import {
  componentSelectionSchema,
  sessionStartSchema,
  trainingDispenseSchema,
} from '../schemas/weighing-station-schemas.js';

export const NO_DEVICE_CAN_WEIGH = 'NO_DEVICE_CAN_WEIGH';
export const SCALE_UNAVAILABLE = 'SCALE_UNAVAILABLE';
export const CONFIRMATION_REFUSED = 'CONFIRMATION_REFUSED';
export const COMPONENT_ALREADY_DONE = 'COMPONENT_ALREADY_DONE';
export const COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

export function createSessionRouter(
  station: WeighingStationModule,
): Router {
  const router = Router();

  /**
   * GET /api/session — the session's current state.
   *
   * 200 — the session, or `null` when none has been started.
   * 401 — no operator session.
   *
   * "No session yet" is a **state**, and it is the UI's first render — so
   * it is a `200` with `session: null`, never a `404`.
   */
  router.get('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const session = await station.sessions.current();

    res.status(200).json({
      session: session === null ? null : serialiseSession(session),
    });
  });

  /**
   * GET /api/session/weight — the current weight and the still-to-weigh.
   *
   * 200 — the weight, or `null` when there is none yet.
   * 401 — no operator session.
   *
   * The weight is the **station's**, not a client's — and the still-to-weigh
   * is `max(0, target − current)`, clamped **in the domain**.
   */
  router.get('/weight', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const session = await station.sessions.current();
    if (session === null) {
      res.status(200).json({ weight: null });
      return;
    }

    const weight = session.currentWeight;

    res.status(200).json({
      weight:
        weight === null
          ? null
          : {
              value: weight.toJSON(),
              unit: weight.unit,
              stable: session.weightIsStable,
              // The last known weight is RETAINED and marked stale when the
              // scale has gone away (BRD IR-13).
              stale: session.weightIsStale,
            },
    });
  });

  /**
   * POST /api/session/select — select a component and bind its scale.
   *
   * 200 — the component is active and the session is `WEIGHING`.
   * 400 — the body is not a selection.
   * 401 — no operator session.
   * 404 — the recipe holds no such component.
   * 409 — the component is `DONE`; or **no device can weigh** this target;
   *       or the chosen scale may not weigh.
   *
   * The operator comes from the **session**, and the body has no field
   * for it — and no field for the scale either.
   */
  router.post('/select', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = componentSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') === '' ? 'body' : issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const outcome = await station.selectComponent.execute(
      parsed.data.componentId,
      req.currentOperator.id.value,
    );

    switch (outcome.kind) {
      case 'SELECTED':
        res.status(200).json({
          session: serialiseSession(outcome.session),
          scaleId: outcome.scaleId.value,
        });
        return;

      case 'NO_DEVICE_CAN_WEIGH':
        // A SUCCESSFUL ANSWER, with the reason as data.
        res.status(409).json({
          error: NO_DEVICE_CAN_WEIGH,
          target: outcome.target,
          maximumCapacity: outcome.maximumCapacity,
          demandedClass: outcome.demandedClass,
        });
        return;

      case 'SCALE_UNAVAILABLE':
        res.status(409).json({
          error: SCALE_UNAVAILABLE,
          reason: outcome.reason,
        });
        return;

      case 'COMPONENT_ALREADY_DONE':
        res.status(409).json({ error: COMPONENT_ALREADY_DONE });
        return;

      case 'UNKNOWN_COMPONENT':
        res.status(404).json({ error: COMPONENT_NOT_FOUND });
        return;
    }
  });

  /**
   * GET /api/session/zone — the current zone.
   *
   * 200 — the zone, the bounds and the still-to-weigh.
   * 401 — no operator session.
   *
   * **The zone is COMPUTED BY THE DOMAIN and returned here.** No consumer —
   * in particular no screen — computes it independently (FR-9, BRD FR-16,
   * BRD FR-17). The same computed zone feeds the status line, the
   * live-weight cell and the progress bar, so they cannot disagree.
   */
  router.get('/zone', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const outcome = station.evaluateZone.execute();

    if (outcome.kind === 'NO_ZONE') {
      res.status(200).json({ zone: null });
      return;
    }

    res.status(200).json({
      zone: outcome.zone,
      value: outcome.value.toJSON(),
      unit: outcome.value.unit,
      target: outcome.target.toJSON(),
      tolerance:
        outcome.tolerance === null
          ? null
          : {
              min: outcome.tolerance.min.toJSON(),
              max: outcome.tolerance.max.toJSON(),
            },
      bounds: {
        nearThreshold: outcome.bounds.nearThreshold.toJSON(),
        okLower: outcome.bounds.okLower.toJSON(),
        okUpper: outcome.bounds.okUpper.toJSON(),
      },
      // `max(0, target − current)` — clamped IN THE DOMAIN.
      stillToWeigh: outcome.stillToWeigh.toJSON(),
    });
  });

  /**
   * POST /api/session/confirm — confirm the weighing.
   *
   * 201 — the weighing was confirmed and the record written.
   * 400 — the body is not a confirmation.
   * 401 — no operator session.
   * 409 — the zone is not `OK`, or the scale has gone away.
   *
   * **The body has no `zone` field and no `actualQuantity` field.** The zone
   * is the domain's, and the actual quantity is the **device's** reading. A
   * client that could assert either could confirm anything.
   */
  router.post('/confirm', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = componentSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') === '' ? 'body' : issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    // THE GATE FIRST, THEN THE TRANSITION.
    //
    // The gate decides whether the weighing may be confirmed at all — the
    // zone must be `OK`, or an authorised escalation must have been
    // consumed (bolt `016`). And only then does the record get written
    // and the session advance (bolt `017`).
    const gate = await station.confirmWeighing.execute(req.currentOperator.id);

    if (gate.kind === 'REFUSED') {
      // The reason distinguishes UNDER, NEAR and OVER, so the UI can show
      // the right next step.
      res.status(409).json({
        error: CONFIRMATION_REFUSED,
        reason: gate.reason,
        zone: gate.zone,
      });
      return;
    }

    if (gate.kind === 'ALREADY_CONFIRMED') {
      // The REPLAY — idempotent per component in a session. The existing
      // record is returned and **nothing** is written.
      res.status(200).json({ record: serialiseRecord(gate.record) });
      return;
    }

    // THE TRANSITION — the record is written first, then the session
    // advances (ADR-040).
    const outcome = await station.confirmComponent.execute(
      parsed.data.componentId,
      req.currentOperator.id,
      gate.zoneAtConfirm,
    );

    switch (outcome.kind) {
      case 'CONFIRMED':
        // THE NEXT COMPONENT'S SCALE. The domain advanced the active
        // component and released the scale; the station binds the next
        // one, so the operator lands on a component ready to weigh.
        const advanced = await station.sessions.current();
        if (outcome.progression.kind === 'ADVANCED' && advanced !== null) {
          await station.startSession(
            advanced.batchId.value,
            req.currentOperator.id.value,
          );
        }
        res.status(201).json({
          record: serialiseRecord(outcome.record),
          // What the session moved to — and `null` when the batch is
          // COMPLETE, which is a distinct outcome (bolt `018`).
          advancedTo:
            outcome.progression.kind === 'ADVANCED'
              ? outcome.progression.to.value
              : null,
          batchComplete: outcome.progression.kind === 'COMPLETED',
        });
        return;

      case 'ALREADY_CONFIRMED':
        // The duplicate is refused — ATOMICALLY, by the `UNIQUE`
        // constraint (ADR-040).
        res.status(409).json({
          error: 'ALREADY_CONFIRMED',
          message: outcome.message,
        });
        return;

      case 'NOT_AVAILABLE':
        res.status(409).json({
          error: CONFIRMATION_REFUSED,
          reason: 'NOT_AVAILABLE',
          zone: null,
        });
        return;
    }
  });

  /**
   * POST /api/session/start — start, or continue, a batch's weighing.
   *
   * The client calls this after the operator selects a batch and its
   * recipe is loaded. The station decides the component (FR-14).
   *
   * 200 — the session, with a component active and its scale bound.
   * 401 — no operator session. 409 — the recipe is not loaded, another
   *       batch is still being weighed, or no scale can weigh it.
   */
  router.post('/start', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = sessionStartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await station.startSession(
      parsed.data.batchId,
      req.currentOperator.id.value,
    );

    switch (outcome.kind) {
      case 'READY':
        res.status(200).json({ session: serialiseSession(outcome.session) });
        return;
      case 'OTHER_BATCH_IN_PROGRESS':
        res.status(409).json({
          error: outcome.kind,
          reason: outcome.kind,
          batchId: outcome.batchId,
        });
        return;
      case 'RECIPE_NOT_LOADED':
        res.status(409).json({ error: outcome.kind, reason: outcome.kind });
        return;
      case 'REFUSED':
        res.status(409).json({ error: outcome.kind, reason: outcome.reason });
        return;
    }
  });

  /**
   * POST /api/session/training/dispense — pour the active component onto
   * its bound training scale (the prototype's "Simulate dispense").
   *
   * TRAINING ONLY. 202 — the ramp started. 400 — not a landing.
   * 401 — no operator session. 409 — no active component, or the bound
   * scale is a real device (a real scale is filled by hand, never by API).
   */
  router.post('/training/dispense', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = trainingDispenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = station.trainingDispense(parsed.data.landing);
    if (outcome !== 'STARTED') {
      res.status(409).json({ error: outcome });
      return;
    }

    res.status(202).json({ landing: parsed.data.landing });
  });

  return router;
}

/**
 * Serialise a weighing record for the wire.
 *
 * The traceability set: the actual quantity, the target and tolerance **as
 * they were**, the zone at confirmation, the device, the lot, the container,
 * the operator and the moment. Every quantity is a **string**.
 */
function serialiseRecord(record: {
  readonly recordId: string;
  readonly sessionId: string;
  readonly componentId: { readonly value: string };
  readonly actualQuantity: { toJSON(): string; readonly unit: string };
  readonly targetAtWeighing: { toJSON(): string };
  readonly toleranceAtWeighing: {
    readonly min: { toJSON(): string };
    readonly max: { toJSON(): string };
  } | null;
  readonly zoneAtConfirm: string;
  readonly scaleId: { readonly value: string };
  readonly scaleClass: string;
  readonly lotNumber: string | null;
  readonly containerId: string | null;
  readonly operatorId: { readonly value: string };
  readonly weighedAt: { toString(): string };
  readonly correctsRecordId: string | null;
}): unknown {
  return {
    recordId: record.recordId,
    sessionId: record.sessionId,
    componentId: record.componentId.value,
    actualQuantity: record.actualQuantity.toJSON(),
    unit: record.actualQuantity.unit,
    targetAtWeighing: record.targetAtWeighing.toJSON(),
    toleranceAtWeighing:
      record.toleranceAtWeighing === null
        ? null
        : {
            min: record.toleranceAtWeighing.min.toJSON(),
            max: record.toleranceAtWeighing.max.toJSON(),
          },
    zoneAtConfirm: record.zoneAtConfirm,
    scaleId: record.scaleId.value,
    scaleClass: record.scaleClass,
    lotNumber: record.lotNumber,
    containerId: record.containerId,
    operatorId: record.operatorId.value,
    weighedAt: record.weighedAt.toString(),
    correctsRecordId: record.correctsRecordId,
  };
}

/**
 * Serialise the session for the wire.
 *
 * The state, the active component, the bound scale, the weight, the
 * component states and the counter. Every quantity is a **string**.
 */
function serialiseSession(session: WeighingSession): unknown {
  return {
    sessionId: session.sessionId,
    batchId: session.batchId.value,
    operatorId: session.operatorId.value,
    state: session.state,
    activeComponentId: session.activeComponentId?.value ?? null,
    selectedScaleId: session.selectedScaleId?.value ?? null,
    currentWeight: session.currentWeight?.toJSON() ?? null,
    weightUnit: session.currentWeight?.unit ?? null,
    weightStable: session.weightIsStable,
    weightStale: session.weightIsStale,
    components: session.components.map((entry) => ({
      componentId: entry.componentId.value,
      state: entry.state,
    })),
    counter: {
      weighed: session.completedCount,
      total: session.componentCount,
    },
  };
}
