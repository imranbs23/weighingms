/**
 * Middleware that resolves the current operator from a bearer token.
 *
 * The token is read from the `Authorization` header, NOT from a query
 * parameter — a query parameter ends up in access logs, `Referer` headers
 * and browser history.
 */
import type { NextFunction, Request, Response } from 'express';
import { SessionToken } from '../../domain/value-objects/session-token.js';
import type { Operator } from '../../domain/entities/operator.js';
import type { IdentityModule } from '../../infrastructure/composition-root.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentOperator?: Operator;
      currentToken?: SessionToken;
    }
  }
}

/** Extract a bearer token from the Authorization header, or null. */
export function extractBearerToken(req: Request): SessionToken | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const raw = match[1];
  if (raw === undefined || raw.trim() === '') return null;
  try {
    return new SessionToken(raw);
  } catch {
    return null;
  }
}

/**
 * Attach the current operator to the request when there is one.
 *
 * This middleware NEVER rejects. It resolves an operator if there is a
 * valid session, and leaves the request anonymous otherwise. Rejection is
 * the job of `requireOperator`.
 */
export function resolveCurrentOperator(identity: IdentityModule) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token = extractBearerToken(req);
      if (token === null) {
        next();
        return;
      }
      const operator = await identity.authentication.currentOperator(token);
      if (operator !== null) {
        req.currentOperator = operator;
        req.currentToken = token;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
