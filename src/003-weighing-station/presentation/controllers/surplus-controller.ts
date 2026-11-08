/**
 * SurplusController — the over-dose, its quantities, and the proposal.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO QUANTITIES, TWO NAMES. THE CLIENT SUPPLIES NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - `GET  /api/surplus` — the over-dose and its quantities.
 * - `POST /api/surplus` — detect it and present the proposal.
 * - `POST /api/surplus/accept` — the operator accepts the proposal.
 * - `POST /api/surplus/decline` — the operator declines it.
 *
 * **The body carries no `factor`, no `surplusAmount` and no
 * `revisedTarget`.** The factor is **computed** by the one compensation
 * implementation, the surplus is the **reading's**, and the revised targets
 * are the **rule's**. A client that could assert any of them could assert a
 * recalculation it liked (ADR-038).
 *
 * WHY THE OVERSHOOT AND THE SURPLUS ARE BOTH REPORTED
 * --------------------------------------------------
 * They are **different quantities** — the excess past the tolerance
 * maximum, and the excess over the target — and the story's own worked
 * numbers differ by exactly the tolerance (`1.9000` and `2.4000`). Reporting
 * only one of them would leave the operator unable to tell how far past
 * tolerance they are from how much extra material they dispensed.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WeighingStationModule } from '../../infrastructure/composition-root.js';

export const PROPOSAL_NOT_FOUND = 'PROPOSAL_NOT_FOUND';
export const PROPOSAL_ALREADY_DECIDED = 'PROPOSAL_ALREADY_DECIDED';
export const NOT_COMPENSABLE = 'NOT_COMPENSABLE';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

/** The decision's body. The component only — no factor, no amounts. */
const decisionSchema = z.object({
  /** The component the proposal is for. */
  componentId: z.string().trim().min(1).max(64),
  /** The reason, when one is given (BRD FR-24). */
  reason: z.string().trim().max(500).optional(),
});

export function createSurplusRouter(
  station: WeighingStationModule,
): Router {
  const router = Router();

  /**
   * GET /api/surplus — the over-dose and its quantities.
   *
   * 200 — the over-dose, or `null` when the zone is not `OVER`.
   * 401 — no operator session.
   *
   * **The quantities are COMPUTED by the domain** — the detector — and
   * reported here. The controller computes nothing.
   */
  router.get('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const session = station.sessions.current();
    const active = session?.activeComponentId ?? null;

    if (active === null || session?.currentWeight === null) {
      res.status(200).json({ surplus: null });
      return;
    }

    const zone = station.evaluateZone.execute();
    if (zone.kind !== 'ZONED' || zone.zone !== 'OVER') {
      // Not an over-dose — no surplus, and the over-dose response is not
      // offered.
      res.status(200).json({ surplus: null });
      return;
    }

    const detected = station.detectOverdose(
      zone.value,
      zone.target,
      zone.tolerance,
      zone.zone,
    );

    if (detected.kind === 'NOT_OVER') {
      res.status(200).json({ surplus: null });
      return;
    }

    res.status(200).json({
      surplus: {
        componentId: active.value,
        overshoot: detected.overshoot.toJSON(),
        surplusAmount: detected.surplus.toJSON(),
        unit: detected.surplus.unit,
        // `null` at a zero target — the percentage is undefined there, and
        // it is omitted rather than zero.
        surplusPercent: detected.surplusPercent,
      },
    });
  });

  /**
   * POST /api/surplus — detect the over-dose and present the proposal.
   *
   * 201 — the proposal was presented.
   * 401 — no operator session.
   * 409 — the zone is not `OVER`, or the surplus is not compensable.
   */
  router.post('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const outcome = await station.proposeCompensation.execute(
      req.currentOperator.id,
    );

    switch (outcome.kind) {
      case 'PROPOSED':
        res.status(201).json({
          proposal: serialiseProposal(outcome.proposal),
          overshoot: outcome.overshoot.toJSON(),
          surplus: outcome.surplus.toJSON(),
          unit: outcome.surplus.unit,
          surplusPercent: outcome.surplusPercent,
        });
        return;

      case 'NOT_COMPENSABLE':
        // The surplus cannot be absorbed. No proposal — and the session
        // escalates (bolt 016).
        res.status(409).json({
          error: NOT_COMPENSABLE,
          reason: outcome.reason,
          surplus: outcome.surplus.toJSON(),
          unit: outcome.surplus.unit,
        });
        return;

      case 'NOT_OVER':
        res.status(409).json({ error: NOT_COMPENSABLE, reason: 'NOT_OVER' });
        return;

      case 'NOT_AVAILABLE':
        res.status(409).json({
          error: NOT_COMPENSABLE,
          reason: 'NOT_AVAILABLE',
        });
        return;
    }
  });

  /**
   * POST /api/surplus/accept — the operator accepts the proposal.
   *
   * 200 — the proposal was accepted.
   * 400 — the body is not a decision.
   * 401 — no operator session.
   * 404 — there is no proposal for this component.
   * 409 — the proposal has already been decided.
   */
  router.post('/accept', async (req: Request, res: Response) => {
    await decide(req, res, station, 'ACCEPTED');
  });

  /**
   * POST /api/surplus/decline — the operator declines the proposal.
   *
   * The same statuses as the acceptance. A declined proposal is recorded,
   * the over-dose is **not** confirmed, and the batch is held.
   */
  router.post('/decline', async (req: Request, res: Response) => {
    await decide(req, res, station, 'DECLINED');
  });

  return router;
}

/** The decision's shared path. */
async function decide(
  req: Request,
  res: Response,
  station: WeighingStationModule,
  decision: 'ACCEPTED' | 'DECLINED',
): Promise<void> {
  if (req.currentOperator === undefined) {
    res.status(401).json({ error: UNAUTHENTICATED });
    return;
  }

  const parsed = decisionSchema.safeParse(req.body);
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

  const outcome = await station.decideProposal.execute(
    parsed.data.componentId,
    decision,
    req.currentOperator.id,
    parsed.data.reason ?? null,
  );

  switch (outcome.kind) {
    case 'DECIDED':
      res.status(200).json({
        proposalId: outcome.proposalId,
        status: outcome.status,
        decidedAt: outcome.decidedAt,
      });
      return;

    case 'NOT_FOUND':
      res.status(404).json({ error: PROPOSAL_NOT_FOUND });
      return;

    case 'ALREADY_DECIDED':
      res.status(409).json({ error: PROPOSAL_ALREADY_DECIDED });
      return;
  }
}

/**
 * Serialise a proposal for the wire.
 *
 * The factor, the surplus, the overshoot, the percentage and the revised
 * targets — every quantity a **string**.
 */
function serialiseProposal(proposal: {
  readonly proposalId: string;
  readonly componentId: string;
  readonly sessionId: string;
  readonly surplusAmount: { toJSON(): string; readonly unit: string };
  readonly overshoot: { toJSON(): string };
  readonly surplusPercent: string | null;
  readonly factor: string;
  readonly recalculated: readonly {
    readonly componentId: string;
    readonly originalTarget: { toJSON(): string };
    readonly revisedTarget: { toJSON(): string };
  }[];
  readonly operatorId: { readonly value: string };
  readonly createdAt: { toString(): string };
  readonly status: string;
  readonly decidedAt: { toString(): string } | null;
  readonly reason: string | null;
}): unknown {
  return {
    proposalId: proposal.proposalId,
    componentId: proposal.componentId,
    sessionId: proposal.sessionId,
    surplusAmount: proposal.surplusAmount.toJSON(),
    unit: proposal.surplusAmount.unit,
    overshoot: proposal.overshoot.toJSON(),
    surplusPercent: proposal.surplusPercent,
    factor: proposal.factor,
    status: proposal.status,
    operatorId: proposal.operatorId.value,
    createdAt: proposal.createdAt.toString(),
    decidedAt: proposal.decidedAt === null ? null : proposal.decidedAt.toString(),
    reason: proposal.reason,
    recalculated: proposal.recalculated.map((entry) => ({
      componentId: entry.componentId,
      originalTarget: entry.originalTarget.toJSON(),
      revisedTarget: entry.revisedTarget.toJSON(),
    })),
  };
}
