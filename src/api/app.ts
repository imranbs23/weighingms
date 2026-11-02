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

export interface AppOptions {
  readonly identity: IdentityModule;
  readonly scales: ScaleModule;
  /** The OrgaTEX seam — the MES read path (unit 005). */
  readonly orgatex: OrgatexModule;
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
