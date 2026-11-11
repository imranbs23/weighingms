/**
 * The printer's status — the terminal's status strip entry (story 005).
 *
 * The strip shows a printer that is out of paper BEFORE a batch is
 * completed (BRD IR-16), so the operator is not surprised by a ticket that
 * does not print. TELEMETRY, like the scales' (ADR-013) — no session.
 */
import { Router, type Request, type Response } from 'express';
import type { TicketModule } from '../../infrastructure/composition-root.js';

export function createPrinterRouter(tickets: TicketModule): Router {
  const router = Router();

  /**
   * GET /api/printer/status
   *
   * 200 — `{ state: 'READY' | 'UNAVAILABLE', reason, source: 'DUMMY' }`.
   */
  router.get('/status', (_req: Request, res: Response) => {
    const status = tickets.trainingPrinter.status();
    res.status(200).json({
      state: status.available ? 'READY' : 'UNAVAILABLE',
      reason: status.reason,
      source: 'DUMMY',
    });
  });

  return router;
}
