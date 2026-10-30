/**
 * Middleware that REQUIRES a signed-in operator.
 *
 * Every refusal reason — no token, expired session, ended session, tampered
 * token, deactivated operator — produces the SAME 401 response. The
 * difference between "no token" and "bad token" is exactly what an attacker
 * probes for, so it is not observable.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Operator } from '../../domain/entities/operator.js';

export const UNAUTHENTICATED_ERROR = 'UNAUTHENTICATED';

export function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const operator: Operator | undefined = req.currentOperator;
  if (operator === undefined) {
    res.status(401).json({ error: UNAUTHENTICATED_ERROR });
    return;
  }
  next();
}
