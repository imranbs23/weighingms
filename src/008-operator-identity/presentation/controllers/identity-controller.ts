/**
 * IdentityController — the HTTP boundary for the identity unit.
 *
 * THE RESPONSE DISCIPLINE
 * -----------------------
 *
 *   sign-in failure  →  401 { "error": "AUTHENTICATION_FAILED" }
 *
 *   ONE body for EVERY cause: unknown operator, wrong secret, deactivated
 *   operator, unavailable source. There is no field that distinguishes
 *   them. `AUTHENTICATION_FAILED` is deliberately ambiguous about WHICH of
 *   the two it was — two responses would turn this endpoint into an
 *   identity oracle.
 *
 *   session refusal  →  401 { "error": "UNAUTHENTICATED" }
 *
 *   ONE body for EVERY cause: no token, expired, ended, tampered,
 *   deactivated operator.
 *
 * The two codes differ from each other because "your credential was
 * rejected" and "you have no session" are not sensitive to distinguish —
 * both mean "you are not signed in" — and keeping them apart makes the
 * API legible to a developer without making it an oracle.
 */
import { Router, type Request, type Response } from 'express';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { SessionToken } from '../../domain/value-objects/session-token.js';
import type { IdentityModule } from '../../infrastructure/composition-root.js';
import {
  signInSchema,
  signOutSchema,
} from '../schemas/identity-schemas.js';
import { extractBearerToken } from '../middleware/resolve-current-operator.js';

export const AUTHENTICATION_FAILED_ERROR = 'AUTHENTICATION_FAILED';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export function createIdentityRouter(identity: IdentityModule): Router {
  const router = Router();

  /**
   * POST /api/identity/sign-in
   */
  router.post('/sign-in', async (req: Request, res: Response) => {
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      // A malformed request is rejected BEFORE the credential store is
      // consulted. It describes the request's shape, never the state of
      // the store.
      res.status(400).json({
        error: VALIDATION_ERROR,
        fields: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    let operatorId: OperatorId;
    try {
      operatorId = OperatorId.create(parsed.data.operatorId);
    } catch {
      // An id that cannot be parsed is treated as an authentication
      // failure, not a validation error — the id's validity says nothing
      // about whether the identity exists.
      res.status(401).json({ error: AUTHENTICATION_FAILED_ERROR });
      return;
    }

    const outcome = await identity.authentication.signIn(
      operatorId,
      parsed.data.secret,
    );

    if (!outcome.isSuccess()) {
      // The ONE failure response. Byte-for-byte identical for every cause.
      res.status(401).json({ error: AUTHENTICATION_FAILED_ERROR });
      return;
    }

    const session = outcome.getSession();
    if (session === null) {
      res.status(401).json({ error: AUTHENTICATION_FAILED_ERROR });
      return;
    }

    const stamp = await identity.authentication.currentStamp(session.token);
    if (stamp === null) {
      // The session was created but cannot be resolved — treat it as a
      // failure rather than returning a half-populated session.
      res.status(401).json({ error: AUTHENTICATION_FAILED_ERROR });
      return;
    }

    res.status(200).json({
      token: session.token.raw,
      sessionId: session.id,
      operator: stamp.toJSON(),
      expiresAt: session.expiresAt.toISOString(),
      authenticatedAt: session.authenticatedAt.toISOString(),
      method: session.method.value,
    });
  });

  /**
   * POST /api/identity/sign-out
   *
   * IDEMPOTENT. Signing out with an unknown or already-ended token returns
   * 200 — failing would disclose whether the token was ever valid.
   */
  router.post('/sign-out', async (req: Request, res: Response) => {
    const token = extractBearerToken(req) ?? tokenFromBody(req);
    if (token === null) {
      res.status(200).json({ signedOut: true, sessionId: null });
      return;
    }
    const session = await identity.authentication.signOut(token);
    res.status(200).json({
      signedOut: true,
      sessionId: session?.id ?? null,
    });
  });

  /**
   * GET /api/identity/current
   *
   * The endpoint every other unit's UI calls to show "who is signed in".
   */
  router.get('/current', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token === null) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const stamp = await identity.authentication.currentStamp(token);
    if (stamp === null) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const session = await identity.authentication.currentSession(token);
    res.status(200).json({
      operator: stamp.toJSON(),
      sessionId: session?.id ?? null,
      expiresAt: session?.expiresAt.toISOString() ?? null,
    });
  });

  /**
   * GET /api/identity/session
   *
   * The session's own fields, for the top bar.
   */
  router.get('/session', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token === null) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const session = await identity.authentication.currentSession(token);
    if (session === null) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    res.status(200).json({
      sessionId: session.id,
      operatorId: session.operatorId.value,
      role: session.role.value,
      method: session.method.value,
      authenticatedAt: session.authenticatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  return router;
}

/**
 * Read a token from the request body, for clients that cannot set headers.
 *
 * The `Authorization` header is preferred; this is a fallback so a simple
 * client can still sign out.
 */
function tokenFromBody(req: Request): SessionToken | null {
  const parsed = signOutSchema.safeParse(req.body);
  if (!parsed.success) return null;
  try {
    return new SessionToken(parsed.data.token);
  } catch {
    return null;
  }
}
