/**
 * The scanner's status — the terminal's status strip entry (story 005).
 *
 * TELEMETRY, like the scales' (ADR-013): a read of the device's state with
 * no operator data in it, so it needs no session. The training scanner
 * reports its connection; a real one would report through its own adapter.
 */
import { Router, type Request, type Response } from 'express';
import type { BatchManagementModule } from '../../infrastructure/composition-root.js';
import { DummyBatchScanner } from '../../infrastructure/adapters/dummy-batch-scanner.js';

export function createScannerRouter(batches: BatchManagementModule): Router {
  const router = Router();

  /**
   * GET /api/scanner/status
   *
   * 200 — `{ state: 'READY' | 'DISCONNECTED', source: 'DUMMY' | 'DEVICE' }`.
   * A device that cannot report its state is `UNKNOWN`, never `READY`.
   */
  router.get('/status', (_req: Request, res: Response) => {
    const scanner = batches.scanner;
    if (!(scanner instanceof DummyBatchScanner)) {
      res.status(200).json({ state: 'UNKNOWN', source: 'DEVICE' });
      return;
    }

    res.status(200).json({
      state: scanner.isConnected() ? 'READY' : 'DISCONNECTED',
      source: 'DUMMY',
    });
  });

  return router;
}
