/**
 * AuditController — the trail's query and its export.
 *
 * ══════════════════════════════════════════════════════════════════════
 * READING THE TRAIL IS A SUPERVISOR'S ACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The trail holds **every** privileged action — every override, every
 * reprint, every configuration change, with their actors and their
 * reasons. **That is not the operator's business.** It is the
 * supervisor's, and the compliance reviewer's.
 *
 * **And the role comes from the SESSION's operator** — never from the
 * request (ADR-044).
 *
 * And the reprint, in the same unit, is deliberately **not**
 * supervisor-gated: it touches one ticket and needs attribution and a
 * reason. The distinction is the **scope of what is disclosed**.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TicketModule } from '../../infrastructure/composition-root.js';
import {
  MAX_PAGE_SIZE,
  boundPageSize,
} from '../../application/use-cases/audit-trail.js';

export const SUPERVISOR_REQUIRED = 'SUPERVISOR_REQUIRED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

/** The query's parameters — the **selection**, not the content. */
const querySchema = z.object({
  actorId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

export function createAuditRouter(tickets: TicketModule): Router {
  const router = Router();

  /**
   * GET /api/audit/trail — the query.
   *
   * 200 — the matching entries, and whether there is more.
   * 401 — no operator session.
   * 403 — the operator is not a supervisor.
   */
  router.get('/trail', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    // THE ROLE. From the SESSION — never from the request.
    if (!req.currentOperator.isSupervisor()) {
      res.status(403).json({ error: SUPERVISOR_REQUIRED });
      return;
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const page = await tickets.queryAuditTrail.execute(
      {
        actorId: parsed.data.actorId ?? null,
        action: parsed.data.action ?? null,
        from: parsed.data.from ? new Date(parsed.data.from) : null,
        to: parsed.data.to ? new Date(parsed.data.to) : null,
      },
      parsed.data.limit,
    );

    res.status(200).json({
      entries: page.entries.map(serialiseEntry),
      hasMore: page.hasMore,
    });
  });

  /**
   * GET /api/audit/trail/export — the export.
   *
   * 200 — the artefact. **The body IS the artefact** — `application/x-ndjson`,
   * one JSON object per line — because the artefact must be **streamable**:
   * a reader consumes it line by line, which is what lets a multi-year
   * export avoid one buffer (ADR-044).
   */
  router.get('/trail/export', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    if (!req.currentOperator.isSupervisor()) {
      res.status(403).json({ error: SUPERVISOR_REQUIRED });
      return;
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const filter = {
      actorId: parsed.data.actorId ?? null,
      action: parsed.data.action ?? null,
      from: parsed.data.from ? new Date(parsed.data.from) : null,
      to: parsed.data.to ? new Date(parsed.data.to) : null,
    };

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');

    // AND IT IS STREAMED — one entry at a time, written as it arrives.
    // The whole result is never assembled in memory.
    for await (const line of tickets.exportAuditTrail.lines(filter)) {
      res.write(line);
    }
    res.end();
  });

  return router;
}

/**
 * Serialise one entry — every field, intact.
 */
function serialiseEntry(entry: {
  readonly sequence: number | null;
  readonly entryId: string;
  readonly action: { readonly value: string };
  readonly actorId: string;
  readonly actorRole: string;
  readonly subject: { readonly value: string };
  readonly reason: string;
  readonly occurredAt: { toDate(): Date };
}): unknown {
  return {
    sequence: entry.sequence,
    entryId: entry.entryId,
    action: entry.action.value,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    subject: entry.subject.value,
    reason: entry.reason,
    occurredAt: entry.occurredAt.toDate().toISOString(),
  };
}
