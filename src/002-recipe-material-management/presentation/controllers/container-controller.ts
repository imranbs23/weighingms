/**
 * ContainerController — the container assignment's endpoints.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO ENDPOINTS. ONE VERB EACH. AND NOTHING ELSE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `POST /api/container` — assign a container and establish its tare.
 * - `GET  /api/container/:componentId` — the effective assignment.
 *
 * WHY THE ASSIGNMENT IS ITS OWN RESOURCE
 * -------------------------------------
 * The container and the tare belong to a **component's** dispense, and they
 * change as the operator moves between components. They are not a property
 * of the recipe — the recipe is read-only (BRD BR-04) — and they are not a
 * property of the scale, whose own tare is its current zero reference and
 * is never persisted (ADR-015).
 *
 * So the assignment is a resource of its own, with its own path, and the
 * effective one is the **newest row** (ADR-035).
 *
 * WHY A `409` FOR A REFUSED TARE
 * -----------------------------
 * The scale **refused** — it is disconnected, its calibration has expired,
 * it will not respond. The request was well-formed, and it conflicts with
 * the current state of the device. That is exactly what `409 Conflict`
 * means.
 *
 * **And nothing was written.** The tare is applied first, and the
 * assignment is recorded only after the device accepted it — so a refused
 * tare leaves the previous assignment standing (the same refusal rule unit
 * `004` applies to the device's own tare, S-14).
 *
 * NO PROSE CROSSES THIS BOUNDARY
 * ------------------------------
 * The body carries **codes** and data, never a sentence (BRD NFR-11,
 * FR-22). The diagnostic goes to the log (BRD IR-09); the operator-facing
 * text is the UI's.
 */
import { Router, type Request, type Response } from 'express';
import type { RecipeMaterialModule } from '../../infrastructure/composition-root.js';
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import {
  containerAssignmentSchema,
} from '../schemas/container-schemas.js';

export const TARE_REFUSED = 'TARE_REFUSED';
export const SCALE_UNAVAILABLE = 'SCALE_UNAVAILABLE';
export const COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND';
export const CONTAINER_NOT_FOUND = 'CONTAINER_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

export function createContainerRouter(
  recipes: RecipeMaterialModule,
): Router {
  const router = Router();

  /**
   * GET /api/container/:componentId — the effective assignment.
   *
   * 200 — the assignment, or `null` when no container has been assigned.
   * 401 — no operator session.
   *
   * An unassigned component is a **200 with `null`**, never a `404`.
   * "No container yet" is a state, and the rail renders it.
   */
  router.get('/:componentId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const componentId = req.params['componentId'];
    if (typeof componentId !== 'string' || componentId.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const assignment = await recipes.assignContainer.current(componentId);

    res.status(200).json({
      assignment:
        assignment === null ? null : serialiseAssignment(assignment),
    });
  });

  /**
   * POST /api/container — assign a container and establish its tare.
   *
   * 201 — the container was assigned and the tare applied.
   * 400 — the body is not an assignment.
   * 401 — no operator session.
   * 404 — the recipe holds no such component, or the master holds no such
   *       container.
   * 409 — the scale refused the tare. Nothing was written.
   * 503 — the scale produced no reading, so the empty container could not
   *       be weighed.
   *
   * The operator comes from the **session**, and the method and the tare
   * source are **derived** (ADR-030, ADR-035).
   */
  router.post('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = containerAssignmentSchema.safeParse(req.body);
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

    // The method is DERIVED from the request's shape. A `code` came from
    // the scanner; a `containerId` was typed in.
    const method = parsed.data.code !== undefined ? 'SCAN' : 'KEYED_IN';
    const containerId =
      parsed.data.code !== undefined
        ? (parsed.data.code as string)
        : (parsed.data.containerId as string);

    let scaleId: ScaleId;
    try {
      scaleId = ScaleId.create(parsed.data.scaleId);
    } catch {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: [{ path: 'scaleId', message: 'must not exceed 64 characters' }],
      });
      return;
    }

    const outcome = await recipes.assignContainer.execute(
      parsed.data.componentId,
      containerId,
      method,
      scaleId,
      req.currentOperator.id,
    );

    switch (outcome.kind) {
      case 'ASSIGNED':
        res.status(201).json({
          assignment: serialiseAssignment(outcome.assignment),
        });
        return;

      case 'UNKNOWN_COMPONENT':
        res.status(404).json({ error: COMPONENT_NOT_FOUND });
        return;

      case 'UNKNOWN_CONTAINER':
        res.status(404).json({ error: CONTAINER_NOT_FOUND });
        return;

      case 'TARE_REFUSED':
        // The scale refused. Nothing was written, and the previous
        // assignment stands.
        res.status(409).json({
          error: TARE_REFUSED,
          reason: outcome.reason,
        });
        return;

      case 'SCALE_UNAVAILABLE':
        // The device produced no reading — it is absent, never present
        // with a reading of zero (S-1).
        res.status(503).json({ error: SCALE_UNAVAILABLE });
        return;
    }
  });

  return router;
}

/**
 * Serialise an assignment for the wire.
 *
 * The container, its type, the tare **with its unit**, the tare's source,
 * the method, the operator and the moment. The tare is a **string** — it
 * is a weight, never a float (BRD NFR-16).
 */
function serialiseAssignment(assignment: {
  readonly componentId: { readonly value: string };
  readonly containerId: { readonly value: string };
  readonly containerType: string;
  readonly tareWeight: { toJSON(): string; readonly unit: string };
  readonly tareSource: string;
  readonly assignmentMethod: string;
  readonly assignedBy: { readonly value: string };
  readonly assignedAt: { toString(): string };
  readonly scaleId: { readonly value: string } | null;
}): unknown {
  return {
    componentId: assignment.componentId.value,
    containerId: assignment.containerId.value,
    containerType: assignment.containerType,
    tareWeight: assignment.tareWeight.toJSON(),
    tareUnit: assignment.tareWeight.unit,
    tareSource: assignment.tareSource,
    assignmentMethod: assignment.assignmentMethod,
    assignedBy: assignment.assignedBy.value,
    assignedAt: assignment.assignedAt.toString(),
    scaleId: assignment.scaleId === null ? null : assignment.scaleId.value,
  };
}
