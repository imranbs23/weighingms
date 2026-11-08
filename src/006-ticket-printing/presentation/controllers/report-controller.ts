/**
 * ReportController — the operational report.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SUPERVISOR'S ACT, OVER A PERIOD, AND IT MUTATES NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The period is a **selection** — the only thing the client chooses.
 * Every row, every count and the progress are computed.
 *
 * **And a zero period is a `200` with zero counts** — the absence of a
 * failure is itself reportable, and a supervisor must be able to tell a
 * quiet period from a broken query (ADR-046).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TicketModule } from '../../infrastructure/composition-root.js';

export const SUPERVISOR_REQUIRED = 'SUPERVISOR_REQUIRED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const UNKNOWN_SHIFT = 'UNKNOWN_SHIFT';

/** The period — a range, or a named shift. */
const querySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    shift: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      (value.from !== undefined && value.to !== undefined) ||
      value.shift !== undefined,
    { message: 'a period is required — a from/to range, or a shift' },
  );

export function createReportRouter(tickets: TicketModule): Router {
  const router = Router();

  /**
   * GET /api/report/tolerance — the report.
   *
   * 200 — the report. **Including a zero period.**
   * 400 — the period is missing or malformed.
   * 401 — no operator session.
   * 403 — the operator is not a supervisor.
   */
  router.get('/tolerance', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    // THE ROLE. From the SESSION — the report is the exception history,
    // and that is a supervisor's record (ADR-046).
    if (!req.currentOperator.isSupervisor()) {
      res.status(403).json({ error: SUPERVISOR_REQUIRED });
      return;
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    // THE PERIOD. A named shift resolves to a range — **one query, two
    // ways of naming the period**.
    let period: { from: Date; to: Date } | null;

    if (parsed.data.shift !== undefined) {
      period = await tickets.shifts.resolve(parsed.data.shift);
    } else {
      period = {
        from: new Date(parsed.data.from as string),
        to: new Date(parsed.data.to as string),
      };
    }

    if (period === null) {
      res.status(404).json({ error: UNKNOWN_SHIFT });
      return;
    }

    const report = await tickets.buildToleranceReport.execute(period);

    res.status(200).json({ report: serialiseReport(report) });
  });

  return router;
}

/**
 * Serialise the report.
 *
 * **Every quantity is a STRING** — the record's own (BRD NFR-16).
 */
function serialiseReport(report: {
  readonly period: { from: Date; to: Date };
  readonly failureCount: number;
  readonly overrideCount: number;
  readonly failures: readonly {
    sessionId: string;
    componentId: string;
    zone: string;
    actualQuantity: string;
    unit: string;
    operatorId: string;
    weighedAt: Date;
  }[];
  readonly overrides: readonly {
    sequence: number;
    sessionId: string;
    componentId: string;
    actualQuantity: string;
    unit: string;
    actorId: string;
    actorRole: string;
    reason: string;
    occurredAt: Date;
  }[];
  readonly progress: readonly {
    batchId: string;
    weighed: number;
    total: number;
    state: string;
  }[];
}): unknown {
  return {
    period: {
      from: report.period.from.toISOString(),
      to: report.period.to.toISOString(),
    },
    failureCount: report.failureCount,
    overrideCount: report.overrideCount,
    failures: report.failures.map((failure) => ({
      sessionId: failure.sessionId,
      componentId: failure.componentId,
      zone: failure.zone,
      actualQuantity: failure.actualQuantity,
      unit: failure.unit,
      operatorId: failure.operatorId,
      weighedAt: failure.weighedAt.toISOString(),
    })),
    overrides: report.overrides.map((override) => ({
      sequence: override.sequence,
      sessionId: override.sessionId,
      componentId: override.componentId,
      actualQuantity: override.actualQuantity,
      unit: override.unit,
      actorId: override.actorId,
      actorRole: override.actorRole,
      reason: override.reason,
      occurredAt: override.occurredAt.toISOString(),
    })),
    progress: report.progress.map((entry) => ({
      batchId: entry.batchId,
      weighed: entry.weighed,
      total: entry.total,
      state: entry.state,
    })),
  };
}
