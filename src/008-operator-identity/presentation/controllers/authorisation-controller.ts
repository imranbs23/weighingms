/**
 * AuthorisationController — the HTTP boundary for privileged actions.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE UNIFORM REFUSAL (ADR-004)
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every refusal returns:
 *
 *   403 { "error": "AUTHORISATION_REFUSED" }
 *
 * ONE body, ONE status, for EVERY cause — including a wrong supervisor
 * credential, an unknown supervisor id, a missing reason, a
 * self-authorisation, a wrong scope, an expired authorisation and an
 * already-used one.
 *
 * WHY A PRECISE ERROR WOULD BE A DEFECT
 * -------------------------------------
 * A refusal reason names which control fired. A caller who learns that
 * `SELF_AUTHORISATION` fired has learned TWO things: that a distinct-person
 * check exists, and — crucially — that their CREDENTIAL WAS ACCEPTED.
 * That is an oracle for credential validity, not merely for supervisor
 * existence. A distinguishable status code (401 for a bad credential, 403
 * for a spent authorisation) is the same leak one field deeper.
 *
 * The NAMED reason is not discarded — it travels to the audit trail via
 * the `PrivilegeRefused` event, which is where the story requires it
 * (BRD FR-36, BRD NFR-13).
 *
 * NOTE THAT THIS CONTROLLER DOES NOT BRANCH ON THE REASON
 * ------------------------------------------------------
 * It returns a constant. There is no `switch` over refusal reasons that a
 * future developer could extend, so a new refusal reason has NOWHERE to
 * leak to.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONE DELIBERATE EXCEPTION
 * ══════════════════════════════════════════════════════════════════════
 * A MALFORMED REQUEST is rejected with 400 VALIDATION_ERROR, before any
 * credential lookup happens. It describes the shape of the request, which
 * the caller already knows, and it is returned before the credential store
 * is consulted. The constant-response rule governs failures OF
 * AUTHORISATION, not malformed requests.
 */
import { Router, type Request, type Response } from 'express';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { PrivilegedAction } from '../../domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../domain/value-objects/authorisation-subject.js';
import type { IdentityModule } from '../../infrastructure/composition-root.js';
import {
  authoriseSchema,
  consumeSchema,
} from '../schemas/authorisation-schemas.js';

export const AUTHORISATION_REFUSED_ERROR = 'AUTHORISATION_REFUSED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED_ERROR = 'UNAUTHENTICATED';

/** The ONE refusal response. Every cause produces exactly this body. */
const REFUSED_BODY = { error: AUTHORISATION_REFUSED_ERROR } as const;

export function createAuthorisationRouter(identity: IdentityModule): Router {
  const router = Router();

  /**
   * POST /api/identity/authorisations
   *
   * The supervisor authenticates AT THE POINT OF THE ACTION and an
   * authorisation is created.
   */
  router.post('/authorisations', async (req: Request, res: Response) => {
    // The REQUESTER must have a live session. A privileged action is
    // performed BY an operator at the terminal; without one there is no
    // operator for the authorisation to be distinct from, and the story
    // requires that attempt to be refused and audited.
    //
    // The supervisor authenticates IN THIS REQUEST (that is the fresh
    // authentication A-2 requires) — but the supervisor's session is not
    // what authorises the action. The operator's session is.
    const actor = req.currentOperator?.id ?? null;
    if (actor === null) {
      res.status(401).json({ error: UNAUTHENTICATED_ERROR });
      return;
    }

    const parsed = authoriseSchema.safeParse(req.body);
    if (!parsed.success) {
      // Malformed request — rejected BEFORE the credential store is
      // consulted.
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    // The operator at the terminal is the one the authorisation must be
    // DISTINCT from. It comes from the session, never from the body.
    let supervisorId: OperatorId;
    try {
      supervisorId = OperatorId.create(parsed.data.supervisorId);
    } catch {
      // An id that cannot be parsed is a refusal, not a validation error —
      // the id's validity says nothing about whether the identity exists.
      res.status(403).json(REFUSED_BODY);
      return;
    }

    let action: PrivilegedAction;
    let subject: AuthorisationSubject;
    try {
      action = PrivilegedAction.of(parsed.data.action);
      subject = AuthorisationSubject.create(parsed.data.subject);
    } catch {
      res.status(403).json(REFUSED_BODY);
      return;
    }

    const outcome = await identity.authorisation.authorise({
      supervisorId,
      secret: parsed.data.secret,
      action,
      subject,
      reason: parsed.data.reason,
      requestingOperatorId: actor,
    });

    if (!outcome.isGranted()) {
      // The ONE refusal response. No branch on the reason.
      res.status(403).json(REFUSED_BODY);
      return;
    }

    const authorisation = outcome.getAuthorisation();
    if (authorisation === null) {
      res.status(403).json(REFUSED_BODY);
      return;
    }

    res.status(201).json({
      authorisationId: authorisation.id,
      supervisorId: authorisation.supervisorId.value,
      action: authorisation.action.value,
      subject: authorisation.subject.value,
      reason: authorisation.reason.value,
      authorisedAt: authorisation.authorisedAt.toISOString(),
      expiresAt: authorisation.expiresAt.toISOString(),
    });
  });

  /**
   * GET /api/identity/authorisations/:id
   *
   * For the UI to show the supervisor what they are about to authorise,
   * and for support.
   *
   * Only the operator the authorisation was issued for may read it. A
   * different operator gets the generic refusal — otherwise an operator
   * could read a supervisor's justification text for an authorisation they
   * did not request.
   */
  router.get('/authorisations/:id', async (req: Request, res: Response) => {
    const actor = req.currentOperator?.id ?? null;
    if (actor === null) {
      res.status(401).json({ error: UNAUTHENTICATED_ERROR });
      return;
    }

    const id = req.params['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const authorisation = await identity.authorisationRepository.findById(id);
    if (authorisation === null) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    // The authorisation must be scoped to THIS operator. A supervisor
    // reading their own authorisation is refused too — the authorisation
    // is FOR the requesting operator.
    //
    // BOTH checks are needed. "Not the supervisor" alone would let ANY
    // other operator read a supervisor's justification text for an
    // exception raised for somebody else.
    if (authorisation.supervisorId.equals(actor) || !authorisation.isIssuedFor(actor)) {
      res.status(403).json(REFUSED_BODY);
      return;
    }

    const consumed = await identity.consumptionRepository.existsFor(authorisation.id);

    res.status(200).json({
      authorisationId: authorisation.id,
      supervisorId: authorisation.supervisorId.value,
      action: authorisation.action.value,
      subject: authorisation.subject.value,
      reason: authorisation.reason.value,
      authorisedAt: authorisation.authorisedAt.toISOString(),
      expiresAt: authorisation.expiresAt.toISOString(),
      consumed,
    });
  });

  /**
   * POST /api/identity/authorisations/:id/consume
   *
   * Apply the authorisation to a privileged action, SPENDING it.
   *
   * ADR-003: the authorisation id is NOT a bearer credential. The
   * requester's live session is required too, and that operator must be
   * the one the authorisation was issued for.
   */
  router.post('/authorisations/:id/consume', async (req: Request, res: Response) => {
    const parsed = consumeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const id = req.params['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    // The operator must be present to apply the authorisation.
    const actor = req.currentOperator?.id ?? null;
    if (actor === null) {
      res.status(401).json({ error: UNAUTHENTICATED_ERROR });
      return;
    }

    let action: PrivilegedAction;
    let subject: AuthorisationSubject;
    try {
      action = PrivilegedAction.of(parsed.data.action);
      subject = AuthorisationSubject.create(parsed.data.subject);
    } catch {
      res.status(403).json(REFUSED_BODY);
      return;
    }

    const outcome = await identity.authorisation.consume(id, action, subject, actor);

    if (!outcome.isConsumed()) {
      // The ONE refusal response.
      res.status(403).json(REFUSED_BODY);
      return;
    }

    const consumption = outcome.getConsumption();
    if (consumption === null) {
      res.status(403).json(REFUSED_BODY);
      return;
    }

    res.status(200).json({
      authorisationId: consumption.authorisationId,
      action: consumption.action.value,
      subject: consumption.subject.value,
      consumedAt: consumption.consumedAt.toISOString(),
    });
  });

  return router;
}
