/**
 * EscalationController — the escalation's endpoints.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE REFUSAL IS UNIFORM. AND THE SCOPE IS DERIVED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `GET  /api/escalation/:componentId` — the escalation's state.
 * - `POST /api/escalation` — raise it.
 * - `POST /api/escalation/authorise` — the supervisor authorises it.
 *
 * **AND EVERY REFUSAL FROM THE AUTHORISATION IS THE SAME BODY** —
 * `403 { "error": "AUTHORISATION_REFUSED" }` — because a precise reason is
 * a map of the defences (ADR-004). The reason goes to the **audit trail**,
 * where an auditor needs it and an attacker cannot reach it (ADR-039).
 *
 * **AND THE SCOPE IS NEVER A CLIENT FIELD.** The subject the authorisation
 * is bound to is derived from the session's own ids, so a client cannot
 * present an authorisation issued for a different component or a different
 * session.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WeighingStationModule } from '../../infrastructure/composition-root.js';

export const AUTHORISATION_REFUSED = 'AUTHORISATION_REFUSED';
export const ESCALATION_NOT_FOUND = 'ESCALATION_NOT_FOUND';
export const NOT_ESCALATABLE = 'NOT_ESCALATABLE';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

/** The escalation's body — the component only. No surplus, no scope. */
const escalationSchema = z.object({
  /** The component that was over-dosed. */
  componentId: z.string().trim().min(1).max(64),
});

/**
 * The authorisation's body.
 *
 * The supervisor's id, their secret and the reason — the authorisation's
 * own inputs, exactly as unit `008`'s `AuthorisationRequest` defines them.
 */
const authorisationSchema = z.object({
  /** The supervisor, as presented. */
  supervisorId: z.string().trim().min(1).max(64),
  /** The supervisor's credential — verified fresh, at this moment. */
  secret: z.string().min(1),
  /** The reason — mandatory (BRD AC-06). */
  reason: z.string().trim().min(1).max(500),
  /** Unit `008`'s authorisation id. */
  authorisationId: z.string().trim().min(1).max(128),
});

export function createEscalationRouter(
  station: WeighingStationModule,
): Router {
  const router = Router();

  /**
   * GET /api/escalation/:componentId — the escalation's state.
   *
   * 200 — the escalation, or `null` when there is none.
   * 401 — no operator session.
   */
  router.get('/:componentId', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const escalation = station.escalationFor(
      req.params['componentId'] as string,
    );

    res.status(200).json({
      escalation: escalation === null ? null : serialiseEscalation(escalation),
    });
  });

  /**
   * POST /api/escalation — raise the escalation.
   *
   * 201 — the escalation was raised.
   * 400 — the body is not a request.
   * 401 — no operator session.
   * 409 — the surplus is compensable, or the zone is not `OVER`.
   */
  router.post('/', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = escalationSchema.safeParse(req.body);
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

    const outcome = station.escalateOverdose.execute();
    if (outcome.kind !== 'ESCALATED') {
      res.status(409).json({ error: NOT_ESCALATABLE, reason: outcome.kind });
      return;
    }

    station.rememberEscalation(outcome.escalation);
    res.status(201).json({ escalation: serialiseEscalation(outcome.escalation) });
  });

  /**
   * POST /api/escalation/authorise — the supervisor authorises it.
   *
   * 200 — the escalation is `AUTHORISED`.
   * 400 — the body is not an authorisation.
   * 401 — no operator session.
   * 404 — there is no escalation for this component.
   * 403 — the authorisation was **refused**. And the body is **uniform** —
   * the same for every refusal (ADR-004).
   */
  router.post('/authorise', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = authorisationSchema.safeParse(req.body);
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

    const outcome = await station.authoriseEscalation.execute(
      parsed.data.authorisationId,
      parsed.data.supervisorId,
      parsed.data.reason,
    );

    switch (outcome.kind) {
      case 'AUTHORISED':
        res.status(200).json({
          escalation: serialiseEscalation(outcome.escalation),
          recordId: outcome.record.recordId,
        });
        return;

      case 'REFUSED':
        // UNIFORM. No reason, no code — ADR-004.
        res.status(403).json({ error: AUTHORISATION_REFUSED });
        return;

      case 'NOT_FOUND':
        res.status(404).json({ error: ESCALATION_NOT_FOUND });
        return;

      case 'ALREADY_DECIDED':
        res.status(409).json({ error: ESCALATION_NOT_FOUND });
        return;
    }
  });

  return router;
}

/**
 * Serialise an escalation for the wire.
 *
 * The state, the component, the session, the surplus it covers and the
 * scope. Every quantity is a **string**.
 */
function serialiseEscalation(escalation: {
  readonly componentId: string;
  readonly sessionId: string;
  readonly surplusAmount: { toJSON(): string; readonly unit: string };
  readonly state: string;
  readonly authorisationId: string | null;
  readonly supervisorId: string | null;
}): unknown {
  return {
    componentId: escalation.componentId,
    sessionId: escalation.sessionId,
    surplusAmount: escalation.surplusAmount.toJSON(),
    unit: escalation.surplusAmount.unit,
    state: escalation.state,
    authorisationId: escalation.authorisationId,
    supervisorId: escalation.supervisorId,
  };
}
