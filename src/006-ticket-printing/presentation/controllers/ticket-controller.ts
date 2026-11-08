/**
 * TicketController — the ticket, and the print job.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PRINTER FAILURE IS THE JOB'S STATE, NOT THE RESPONSE'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * When the printer is out of paper, what the operator needs is: *which job
 * failed, why, and can I print it again?* That is the **job**.
 *
 * **So the response is a `201` with a `FAILED` job** — the job exists, it
 * failed, and it carries the error. A `500` would say "something went
 * wrong" and give them nothing to act on (BRD FR-19, ADR-042).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TicketModule } from '../../infrastructure/composition-root.js';
import type { Ticket } from '../../domain/entities/ticket.js';
import type { PrintJob } from '../../domain/entities/print-job.js';

export const TICKET_NOT_FOUND = 'TICKET_NOT_FOUND';
export const BATCH_NOT_COMPLETE = 'BATCH_NOT_COMPLETE';
export const REPRINT_REASON_REQUIRED = 'REPRINT_REASON_REQUIRED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

const ticketIdSchema = z.string().trim().min(1).max(64);

/**
 * The reprint's body — **exactly one field: the reason**.
 *
 * **There is no field for `isReprint`, for `reprintOf`, for the actor or
 * for the actor's role.** Those are derived — the reason's presence, the
 * path, and the session (ADR-043).
 *
 * And the reason is **trimmed and bounded** — but the bound is a
 * **validation**, never a **truncation**: a long reason is refused, not
 * silently shortened.
 */
const reprintSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'a reason is required')
    .max(500, 'reason must not exceed 500 characters'),
});

export function createTicketRouter(tickets: TicketModule): Router {
  const router = Router();

  /**
   * POST /api/tickets — generate the ticket.
   *
   * 201 — the ticket was generated.
   * 200 — it already existed — **idempotent**, and the SAME ticket.
   * 409 — the batch is not complete.
   */
  router.post('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const outcome = await tickets.generateTicket.execute();

    if (outcome.kind === 'NOT_COMPLETE') {
      res.status(409).json({ error: BATCH_NOT_COMPLETE });
      return;
    }

    if (outcome.kind === 'NO_BATCH_IDENTITY') {
      res.status(409).json({ error: 'BATCH_IDENTITY_UNKNOWN' });
      return;
    }

    // A duplicate is a `200` — a retry after an ambiguous response must
    // SUCCEED, and the caller gets the same ticket.
    res.status(outcome.isNew ? 201 : 200).json({
      ticket: serialiseTicket(outcome.ticket),
    });
  });

  /**
   * GET /api/tickets/:ticketId — the ticket.
   */
  router.get('/:ticketId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = ticketIdSchema.safeParse(req.params['ticketId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const ticket = await tickets.tickets.findById(parsed.data);
    if (ticket === null) {
      res.status(404).json({ error: TICKET_NOT_FOUND });
      return;
    }

    res.status(200).json({ ticket: serialiseTicket(ticket) });
  });

  /**
   * POST /api/tickets/:ticketId/print — print it.
   *
   * 201 — the job was created. And it carries the job's state — `DONE` or
   * `FAILED`.
   */
  router.post('/:ticketId/print', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = ticketIdSchema.safeParse(req.params['ticketId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await tickets.printTicket.execute(parsed.data);

    if (outcome.kind === 'NOT_FOUND') {
      res.status(404).json({ error: TICKET_NOT_FOUND });
      return;
    }

    // AND THE FAILURE IS THE JOB'S STATE. The operator gets the job — its
    // id, its error, its times — so they can reprint.
    res.status(201).json({ job: serialiseJob(outcome.job) });
  });

  /**
   * POST /api/tickets/:ticketId/reprint — reprint it, with a reason.
   *
   * 201 — the reprint job was created, and the audit entry was written.
   * 400 — the reason is absent or empty — **and no print job was created**.
   * 404 — there is no such ticket.
   *
   * **AND THE BODY HAS EXACTLY ONE FIELD: the reason.** The marking is
   * DERIVED — `isReprint` from the reason's presence, `reprintOf` from the
   * path, the actor and their role from the session (ADR-043).
   */
  router.post('/:ticketId/reprint', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = ticketIdSchema.safeParse(req.params['ticketId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    // THE REASON. MANDATORY.
    const body = reprintSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: REPRINT_REASON_REQUIRED });
      return;
    }

    const outcome = await tickets.reprintTicket.execute(
      parsed.data,
      body.data.reason,
      req.currentOperator.id.value,
      req.currentOperator.role.value,
    );

    if (outcome.kind === 'NOT_FOUND') {
      res.status(404).json({ error: TICKET_NOT_FOUND });
      return;
    }

    if (outcome.kind === 'REASON_REQUIRED') {
      res.status(400).json({ error: REPRINT_REASON_REQUIRED });
      return;
    }

    res.status(201).json({
      job: { jobId: outcome.jobId, state: outcome.jobState },
      auditEntry: {
        sequence: outcome.auditEntry.sequence,
        action: outcome.auditEntry.action.value,
        actorId: outcome.auditEntry.actorId,
        actorRole: outcome.auditEntry.actorRole,
        subject: outcome.auditEntry.subject.value,
        reason: outcome.auditEntry.reason,
        occurredAt: outcome.auditEntry.occurredAt.toDate().toISOString(),
      },
    });
  });

  return router;
}

/**
 * The print job's state — retrievable while it is in flight.
 */
export function createPrintJobRouter(tickets: TicketModule): Router {
  const router = Router();

  router.get('/:jobId', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    const parsed = ticketIdSchema.safeParse(req.params['jobId']);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const job = await tickets.jobs.findById(parsed.data);
    if (job === null) {
      res.status(404).json({ error: 'PRINT_JOB_NOT_FOUND' });
      return;
    }

    res.status(200).json({ job: serialiseJob(job) });
  });

  return router;
}

/**
 * Serialise the ticket.
 *
 * **Every quantity is a STRING** — the record's own (BRD NFR-16, NFR-2).
 *
 * And the ticket carries its **identity, its lines and its outcome** —
 * **not** a physical layout. The layout is configuration's, and the
 * physical format is not settled (BRD IR-16, Q-11, Q-12).
 */
function serialiseTicket(ticket: Ticket): unknown {
  return {
    ticketId: ticket.ticketId,
    sessionId: ticket.sessionId,
    batch: {
      batchId: ticket.batch.batchId,
      orderRef: ticket.batch.orderRef,
      machineRef: ticket.batch.machineRef,
      shadeCode: ticket.batch.shadeCode,
    },
    operatorId: ticket.operatorId,
    generatedAt: ticket.generatedAt.toDate().toISOString(),
    language: ticket.language,
    templateId: ticket.templateId,
    toleranceOutcome: ticket.toleranceOutcome,
    lines: ticket.lines.map((line) => ({
      sequence: line.sequence,
      componentId: line.componentId,
      materialCode: line.materialCode,
      targetQuantity: line.targetQuantity,
      targetUnit: line.targetUnit,
      actualQuantity: line.actualQuantity,
      actualUnit: line.actualUnit,
      lotNumber: line.lotNumber,
      containerId: line.containerId,
      scaleId: line.scaleId,
      zoneAtConfirm: line.zoneAtConfirm,
      operatorId: line.operatorId,
      weighedAt: line.weighedAt.toDate().toISOString(),
    })),
  };
}

/**
 * Serialise the print job — its id, state, times, error and marking.
 */
function serialiseJob(job: PrintJob): unknown {
  return {
    jobId: job.jobId,
    ticketId: job.ticketId,
    state: job.state,
    isReprint: job.isReprint,
    reprintOf: job.reprintOf,
    attemptedAt: job.attemptedAt.toDate().toISOString(),
    completedAt:
      job.completedAt === null
        ? null
        : job.completedAt.toDate().toISOString(),
    error: job.error,
  };
}
