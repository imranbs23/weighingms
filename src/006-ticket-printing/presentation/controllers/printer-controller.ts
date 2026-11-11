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

  /**
   * POST /api/printer/control — TRAINING ONLY: take the dummy printer out
   * of service ("out of paper") or put it back, the same way the scale's
   * link and the Dummy MES's reachability have their controls.
   *
   * 200 — the printer's new state. 400 — not a control. 401 — no session.
   */
  router.post('/control', (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const body = req.body as { available?: unknown; reason?: unknown };
    if (
      typeof body?.available !== 'boolean' ||
      (body.reason !== undefined && typeof body.reason !== 'string')
    ) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: [{ path: 'available', message: 'must be a boolean' }],
      });
      return;
    }

    tickets.trainingPrinter.setAvailable(body.available, body.reason);
    const status = tickets.trainingPrinter.status();
    res.status(200).json({
      state: status.available ? 'READY' : 'UNAVAILABLE',
      reason: status.reason,
    });
  });

  return router;
}
