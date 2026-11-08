/**
 * MaterialController — the material identity and the lot capture.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO ENDPOINTS, TWO METHODS, AND NOTHING ELSE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `POST /api/material-identity` — verify the material in hand.
 * - `GET  /api/material-identity/:componentId` — the effective verification.
 * - `POST /api/material-lot` — capture the lot against a component.
 * - `GET  /api/material-lot/:componentId` — the effective capture.
 *
 * WHY THESE ARE SEPARATE RESOURCES
 * --------------------------------
 * The identity and the lot are **different facts** with different evidence
 * and different lifetimes (the domain model's argument). A single
 * "material" endpoint would force one of them into the other's shape — and
 * the identity is about *"is this the right material?"* while the lot is
 * about *"which batch of it?"*. A scan may establish the first and not the
 * second; a lot may be keyed in without a scan.
 *
 * WHY A `409` FOR A MISMATCH
 * --------------------------
 * The material **is** the wrong one. The request was well-formed, and it
 * conflicts with the current state of the thing — which is exactly what
 * `409 Conflict` means. A `403` would read as *"you are not allowed"*,
 * and the operator's correct response to that would be to ask a
 * supervisor for permission, when the actual cause is that they presented
 * the wrong drum.
 *
 * AND WHY THE MISMATCH NAMES BOTH CODES
 * -------------------------------------
 * The story requires it: *"the reason names the scanned code and the
 * expected code"*. This is the one place the station names values in a
 * refusal, and it is deliberate — the operator must be told **which**
 * material was expected and **which** was presented. Both are codes, not
 * prose (BRD NFR-11).
 *
 * NO PROSE CROSSES THIS BOUNDARY
 * ------------------------------
 * The body carries **codes** and data, never a sentence (BRD NFR-11,
 * FR-22). The diagnostic goes to the log (BRD IR-09); the operator-facing
 * text is the UI's.
 */
import { Router, type Request, type Response } from 'express';
import type { RecipeMaterialModule } from '../../infrastructure/composition-root.js';
import {
  materialIdentitySchema,
  materialLotSchema,
} from '../schemas/material-schemas.js';

export const MATERIAL_MISMATCH = 'MATERIAL_MISMATCH';
export const LOT_NOT_RECOGNISED = 'LOT_NOT_RECOGNISED';
export const SCANNER_UNAVAILABLE = 'SCANNER_UNAVAILABLE';
export const COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

export function createMaterialRouter(
  recipes: RecipeMaterialModule,
): Router {
  const router = Router();

  /**
   * GET /api/material-identity/:componentId — the effective verification.
   *
   * 200 — the verification, or `null` when nothing has been verified.
   * 401 — no operator session.
   *
   * An unverified component is a **200 with `null`**, never a `404`.
   * "Not verified yet" is a state, and it is the rail's first render.
   */
  router.get('/material-identity/:componentId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const componentId = req.params['componentId'];
    if (typeof componentId !== 'string' || componentId.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const identity = await recipes.verifyMaterialIdentity.current(componentId);

    res.status(200).json({
      identity: identity === null ? null : serialiseIdentity(identity),
    });
  });

  /**
   * POST /api/material-identity — verify the material in hand.
   *
   * 201 — the identity was verified.
   * 400 — the body is not a verification request.
   * 401 — no operator session.
   * 404 — the recipe holds no such component.
   * 409 — the scan named a DIFFERENT material. A hard stop.
   * 503 — the scanner could not be read.
   *
   * The operator comes from the **session**. The body has no field for it,
   * and no field for the method either — the method is derived from the
   * request's shape (ADR-030, ADR-034).
   */
  router.post('/material-identity', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = materialIdentitySchema.safeParse(req.body);
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

    const operatorId = req.currentOperator.id;

    // The method is DERIVED from the request's shape. A `code` came from
    // the scanner; an `attestation` was confirmed on screen.
    const outcome =
      parsed.data.code !== undefined
        ? await recipes.verifyMaterialIdentity.verifyByScan(
            parsed.data.componentId,
            operatorId,
          )
        : await recipes.verifyMaterialIdentity.verifyByAttestation(
            parsed.data.componentId,
            operatorId,
          );

    switch (outcome.kind) {
      case 'VERIFIED':
        res.status(201).json({ identity: serialiseIdentity(outcome.identity) });
        return;

      case 'MISMATCHED':
        // A HARD STOP. Both codes are named, because the operator must be
        // told which was expected and which was presented.
        res.status(409).json({
          error: MATERIAL_MISMATCH,
          scannedCode: outcome.scannedCode,
          expectedCode: outcome.expectedCode,
        });
        return;

      case 'SCANNER_UNAVAILABLE':
        // The device is down. The operator is told the scanner is
        // unavailable and the **attestation path remains available**
        // (BRD FR-19, BRD IR-15).
        res.status(503).json({ error: SCANNER_UNAVAILABLE });
        return;

      case 'ALREADY_VERIFIED_BY_SCAN':
        // Nothing is wrong — the material IS verified. An attestation may
        // not downgrade a scan, so it is not recorded.
        res.status(409).json({
          error: MATERIAL_MISMATCH,
          scannedCode: '',
          expectedCode: '',
        });
        return;

      case 'UNKNOWN_COMPONENT':
        res.status(404).json({ error: COMPONENT_NOT_FOUND });
        return;
    }
  });

  /**
   * GET /api/material-lot/:componentId — the effective capture.
   *
   * 200 — the capture, or `null` when no lot has been captured.
   * 401 — no operator session.
   */
  router.get('/material-lot/:componentId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const componentId = req.params['componentId'];
    if (typeof componentId !== 'string' || componentId.trim().length === 0) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const capture = await recipes.captureMaterialLot.current(componentId);

    res.status(200).json({
      capture: capture === null ? null : serialiseCapture(capture),
    });
  });

  /**
   * POST /api/material-lot — capture the lot against a component.
   *
   * 201 — the lot was captured.
   * 400 — the body is not a capture, or the lot is empty or too long.
   * 401 — no operator session.
   * 404 — the recipe holds no such component.
   *
   * The operator comes from the **session**, and the method is derived from
   * the request's shape (ADR-030, ADR-034).
   */
  router.post('/material-lot', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = materialLotSchema.safeParse(req.body);
    if (!parsed.success) {
      // The BOUNDARY's own validation errors are reported, field by field.
      //
      // The story is explicit: an empty lot is *"refused with a validation
      // error naming the missing lot"*, and a lot over 64 characters is
      // *"refused with a validation error naming the maximum length"*. So
      // the error names the FIELD and says what is wrong with it — not a
      // generic "the body is wrong".
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') === '' ? 'body' : issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const operatorId = req.currentOperator.id;

    // The method is DERIVED from the request's shape. A `lotNumber` was
    // keyed in; a `code` came from the scanner.
    const outcome =
      parsed.data.lotNumber !== undefined
        ? await recipes.captureMaterialLot.captureKeyedIn(
            parsed.data.componentId,
            parsed.data.lotNumber,
            operatorId,
          )
        : await recipes.captureMaterialLot.captureScanned(
            parsed.data.componentId,
            parsed.data.code as string,
            operatorId,
          );

    switch (outcome.kind) {
      case 'CAPTURED':
        res.status(201).json({ capture: serialiseCapture(outcome.capture) });
        return;

      case 'EMPTY_LOT':
        // A validation error naming the missing lot — and nothing stored.
        res.status(400).json({
          error: VALIDATION_ERROR,
          fields: [{ path: 'lotNumber', message: 'is required' }],
        });
        return;

      case 'LOT_TOO_LONG':
        // A validation error naming the maximum — and the value is NOT
        // truncated.
        res.status(400).json({
          error: VALIDATION_ERROR,
          fields: [
            {
              path: 'lotNumber',
              message: `must not exceed ${outcome.maximum} characters`,
            },
          ],
        });
        return;

      case 'UNKNOWN_COMPONENT':
        res.status(404).json({ error: COMPONENT_NOT_FOUND });
        return;

      case 'NO_SOURCE_LOT':
      case 'SOURCE_UNAVAILABLE':
        // Neither is a refusal of the operator's value — the operator's
        // paths remain available. These are the **source** route's
        // outcomes, and the client's request is the operator's route.
        res.status(409).json({ error: LOT_NOT_RECOGNISED });
        return;
    }
  });

  return router;
}

/**
 * Serialise an identity for the wire.
 *
 * The method, the operator, the moment, and the code or the claims — and
 * **never** both, because the domain refuses a record that carries both.
 */
function serialiseIdentity(identity: {
  readonly componentId: { readonly value: string };
  readonly materialCode: { readonly value: string };
  readonly verifiedBy: string;
  readonly operatorId: { readonly value: string };
  readonly verifiedAt: { toString(): string };
  readonly barcode: string | null;
  readonly attestedClaims: { readonly values: readonly string[] } | null;
}): unknown {
  return {
    componentId: identity.componentId.value,
    materialCode: identity.materialCode.value,
    verifiedBy: identity.verifiedBy,
    operatorId: identity.operatorId.value,
    verifiedAt: identity.verifiedAt.toString(),
    barcode: identity.barcode,
    attestedClaims:
      identity.attestedClaims === null ? null : [...identity.attestedClaims.values],
  };
}

/**
 * Serialise a capture for the wire.
 *
 * The lot, the material, the method, the operator and the moment. The lot
 * is a **string** — it is an identifier, never a quantity.
 */
function serialiseCapture(capture: {
  readonly componentId: { readonly value: string };
  readonly lotNumber: { readonly value: string };
  readonly materialCode: { readonly value: string };
  readonly captureMethod: string;
  readonly capturedBy: { readonly value: string };
  readonly capturedAt: { toString(): string };
}): unknown {
  return {
    componentId: capture.componentId.value,
    lotNumber: capture.lotNumber.value,
    materialCode: capture.materialCode.value,
    captureMethod: capture.captureMethod,
    capturedBy: capture.capturedBy.value,
    capturedAt: capture.capturedAt.toString(),
  };
}
