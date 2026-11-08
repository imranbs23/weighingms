/**
 * The Express application.
 *
 * Assembles the identity router and the shared middleware. Kept separate
 * from `server.ts` so tests can mount the app without binding a port.
 */
import express, { type Express } from 'express';
import { createIdentityRouter } from '../008-operator-identity/presentation/controllers/identity-controller.js';
import {
  createAuthorisationRouter,
} from '../008-operator-identity/presentation/controllers/authorisation-controller.js';
import {
  resolveCurrentOperator,
} from '../008-operator-identity/presentation/middleware/resolve-current-operator.js';
import { requireOperator } from '../008-operator-identity/presentation/middleware/require-operator.js';
import type { IdentityModule } from '../008-operator-identity/infrastructure/composition-root.js';
import { createScaleRouter } from '../004-scale-integration/presentation/controllers/scale-controller.js';
import {
  createWeightStreamRouter,
} from '../004-scale-integration/presentation/controllers/weight-stream-controller.js';
import type { ScaleModule } from '../004-scale-integration/infrastructure/composition-root.js';
import { createOrgatexRouter } from '../005-orgatex-integration/presentation/controllers/orgatex-controller.js';
import {
  createDummyOrgatexRouter,
} from '../005-orgatex-integration/presentation/controllers/dummy-orgatex-controller.js';
import type { OrgatexModule } from '../005-orgatex-integration/infrastructure/composition-root.js';
import {
  createBatchQueueRouter,
} from '../001-batch-management/presentation/controllers/batch-queue-controller.js';
import {
  createBatchSelectionRouter,
} from '../001-batch-management/presentation/controllers/batch-selection-controller.js';
import type { BatchManagementModule } from '../001-batch-management/infrastructure/composition-root.js';
import {
  createRecipeRouter,
} from '../002-recipe-material-management/presentation/controllers/recipe-controller.js';
import type { RecipeMaterialModule } from '../002-recipe-material-management/infrastructure/composition-root.js';
import type { WeighingStationModule } from '../003-weighing-station/infrastructure/composition-root.js';
import {
  createSessionRouter,
} from '../003-weighing-station/presentation/controllers/session-controller.js';
import {
  createSurplusRouter,
} from '../003-weighing-station/presentation/controllers/surplus-controller.js';
import {
  createEscalationRouter,
} from '../003-weighing-station/presentation/controllers/escalation-controller.js';
import {
  createBatchSummaryRouter,
} from '../003-weighing-station/presentation/controllers/batch-summary-controller.js';
import {
  createMaterialRouter,
} from '../002-recipe-material-management/presentation/controllers/material-controller.js';
import {
  createContainerRouter,
} from '../002-recipe-material-management/presentation/controllers/container-controller.js';
import {
  createTicketRouter,
  createPrintJobRouter,
} from '../006-ticket-printing/presentation/controllers/ticket-controller.js';
import {
  createAuditRouter,
} from '../006-ticket-printing/presentation/controllers/audit-controller.js';
import {
  createConfigurationRouter,
  createLocaleRouter,
} from '../006-ticket-printing/presentation/controllers/configuration-controller.js';
import {
  createReportRouter,
} from '../006-ticket-printing/presentation/controllers/report-controller.js';
import type { TicketModule } from '../006-ticket-printing/infrastructure/composition-root.js';

export interface AppOptions {
  readonly identity: IdentityModule;
  readonly scales: ScaleModule;
  /** The OrgaTEX seam — the MES read path (unit 005). */
  readonly orgatex: OrgatexModule;
  /**
   * The station's own batch queue (unit 001).
   *
   * Optional so that a test which does not care about the queue can leave
   * it out. When it IS present, its endpoint is mounted.
   */
  readonly batches?: BatchManagementModule;
  /**
   * The station's recipe (unit 002).
   *
   * Optional so that a test which does not care about the recipe can leave
   * it out. When it IS present, its endpoint is mounted.
   */
  readonly recipes?: RecipeMaterialModule;
  /**
   * The weighing session (unit 003).
   *
   * Optional so that a test which does not care about the session can leave
   * it out. When it IS present, its endpoints are mounted.
   */
  readonly station?: WeighingStationModule;
  /**
   * The ticket printing (unit 006).
   *
   * Optional so that a test which does not care about tickets can leave it
   * out. When it IS present, its endpoints are mounted.
   */
  readonly tickets?: TicketModule;
  /** Allowed CORS origins. Empty means same-origin only. */
  readonly corsOrigins?: readonly string[];
}

export function createApp(options: AppOptions): Express {
  const { identity, scales, orgatex } = options;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // ── CORS ──
  // The SPA runs on :5173 and the API on :3000, so cross-origin requests
  // are expected. The origin list is explicit rather than a wildcard,
  // because a wildcard with credentials is rejected by browsers and
  // because the token is a bearer credential that must not be readable by
  // arbitrary origins.
  const origins = options.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(resolveCurrentOperator(identity));

  // ── Health ──
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // ── Identity ──
  app.use('/api/identity', createIdentityRouter(identity));

  // ── Authorisation ──
  // The supervisor-authorisation endpoints. They live under the same
  // base path because they are the same bounded context: the identity
  // unit's public surface.
  app.use('/api/identity', createAuthorisationRouter(identity));

  // ── Scale ──
  // The Dummy Scale's read endpoints are open (ADR-013) — a scale's
  // weight and calibration state are physically visible at the station,
  // and the UI needs the status strip before anyone signs in.
  app.use('/api/scales', createScaleRouter(scales));

  // The weight stream is mounted separately because it lives at
  // /api/scales/:scaleId/weight and must not be shadowed by the router
  // above.
  app.use('/api/scales', createWeightStreamRouter(scales));

  // ── OrgaTEX ──
  // The product's own endpoints over the MES seam. They require an
  // operator session (ADR-020): the MES's queue is a business record, not
  // a physically visible device state.
  app.use('/api/orgatex', createOrgatexRouter(orgatex));

  // ── Batch queue ──
  // The STATION's queue (unit 001), not the MES's. It is mounted under its
  // own prefix because `/api/batches` belongs to the Dummy MES, and a
  // route there would be silently captured by the Dummy's batch-detail
  // route (ADR-028).
  if (options.batches !== undefined) {
    app.use('/api/batch-queue', createBatchQueueRouter(options.batches));
    // The selection is a resource of its own, NOT a view of the queue: it
    // is a record the station made, and it outlives the queue — which may
    // be re-fetched or unreachable. So it has its own path, and it does
    // not live under the queue's path where a client would expect it to
    // disappear when the queue did.
    app.use('/api/selection', createBatchSelectionRouter(options.batches));
  }

  // ── Recipe ──
  // The STATION's recipe (unit 002), not the MES's. It lives under its own
  // prefix because `/api/batches/*` belongs to the Dummy MES, whose router
  // owns `/api/batches/:batchId/recipe` — a route under that prefix would
  // be silently captured by it (ADR-032).
  if (options.recipes !== undefined) {
    app.use('/api/recipe', createRecipeRouter(options.recipes));
    // The identity and the lot are SEPARATE RESOURCES, not part of the
    // recipe: they are different facts with different evidence, and a
    // single "material" endpoint would force one into the other's shape
    // (ADR-034).
    app.use('/api', createMaterialRouter(options.recipes));
    // The container assignment is its own resource: it belongs to a
    // component's dispense, and it changes as the operator moves between
    // components (ADR-035).
    app.use('/api/container', createContainerRouter(options.recipes));
  }

  // ── Weighing session ──
  // The session (unit 003) is the pivot of the product. It has its own
  // prefix because the session is a RESOURCE of its own — it is the
  // station's live state, and it outlives any one component's weighing.
  if (options.station !== undefined) {
    app.use('/api/session', createSessionRouter(options.station));
    // The surplus is its own resource — the over-dose is a property of a
    // component's dispense, and the proposal is a record of what was
    // offered and decided (ADR-038).
    app.use('/api/surplus', createSurplusRouter(options.station));
    // The escalation is the over-dose's own awaiting state, and the
    // supervisor's authorisation of it (ADR-039).
    app.use('/api/escalation', createEscalationRouter(options.station));
    // The batch's completion and its summary — the last of unit 003's
    // endpoints.
    app.use('/api/batch', createBatchSummaryRouter(options.station));
  }

  // The ticket and its print job (unit 006).
  //
  // AND THE PRINT PATH HAS NO WEIGHING-RECORD REPOSITORY — so a printer
  // failure cannot cost a weighing (B-7, ADR-042).
  if (options.tickets !== undefined) {
    app.use('/api/tickets', createTicketRouter(options.tickets));
    app.use('/api/print-jobs', createPrintJobRouter(options.tickets));
    // THE AUDIT TRAIL. Reading it is a SUPERVISOR's act — the trail holds
    // every privileged action (ADR-044).
    app.use('/api/audit', createAuditRouter(options.tickets));
    // THE CONFIGURATION. A change is a supervisor's act, and it is audited
    // through the same append-only API (ADR-045).
    app.use('/api/configuration', createConfigurationRouter(options.tickets));
    // THE LOCALE. The bundles are files, read at runtime — so a language
    // is changeable without a redeployment (BRD NFR-11).
    app.use('/api/locale', createLocaleRouter(options.tickets));
    // THE REPORT. A READ MODEL — it reads the recorded zone and mutates
    // nothing (ADR-046).
    app.use('/api/report', createReportRouter(options.tickets));
  }

  // The ticket and its print job (unit 006).
  //
  // AND THE PRINT PATH HAS NO WEIGHING-RECORD REPOSITORY — so a printer
  // failure cannot cost a weighing (B-7, ADR-042).
  if (options.tickets !== undefined) {
    app.use('/api/tickets', createTicketRouter(options.tickets));
    app.use('/api/print-jobs', createPrintJobRouter(options.tickets));
  }

  // ── Dummy OrgaTEX ──
  // The TRAINING ARTEFACT — the MES's own surface, standing in for
  // OrgaTEX. It is mounted separately so it can never be mistaken for the
  // product's API, and a real deployment removes it entirely.
  app.use('/api', createDummyOrgatexRouter(orgatex.world));

  // A route that REQUIRES a signed-in operator — this is the shape other
  // units' protected endpoints will use.
  app.get('/api/identity/protected-probe', requireOperator, (req, res) => {
    res.status(200).json({
      operator: req.currentOperator
        ? {
            operatorId: req.currentOperator.id.value,
            displayName: req.currentOperator.displayName,
            role: req.currentOperator.role.value,
          }
        : null,
    });
  });

  // ── 404 ──
  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // ── Error handler ──
  // The detail goes to the log, never to the client.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      console.error('[api] unhandled error:', err);
      if (res.headersSent) return;
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    },
  );

  return app;
}
