/**
 * AuthenticationService — the unit's primary domain service.
 *
 * Owns the sign-in / sign-out / current-operator flow. It is the only place
 * that knows how a session comes into being, and the only place that can
 * say who the current operator is.
 *
 * The service NEVER sees a plaintext secret except as the argument it
 * forwards to the provider for verification — the hashing and comparison
 * happen inside the provider, which is the only component with that scope.
 */
import type { IdentitySession } from '../entities/identity-session.js';
import {
  SESSION_END_CAUSE_REPLACED,
  SESSION_END_CAUSE_SIGNED_OUT,
} from '../entities/identity-session.js';
import type { Operator } from '../entities/operator.js';
import type { OperatorId } from '../value-objects/operator-id.js';
import type { OperatorStamp } from '../value-objects/operator-stamp.js';
import { AuthenticationOutcome } from '../value-objects/authentication-outcome.js';
import type { SessionToken } from '../value-objects/session-token.js';
import type { IdentityProvider } from './identity-provider.js';
import type { SessionPolicy } from './session-policy.js';
import type { SessionFactory } from './session-factory.js';
import type { OperatorStampFactory } from './operator-stamp-factory.js';
import type { OperatorRepository, SessionRepository } from '../ports/repositories.js';

export class AuthenticationService {
  constructor(
    private readonly provider: IdentityProvider,
    private readonly operators: OperatorRepository,
    private readonly sessions: SessionRepository,
    private readonly policy: SessionPolicy,
    private readonly stamps: OperatorStampFactory,
    private readonly sessionFactory: SessionFactory,
    private readonly sessionLifetimeMs: number,
  ) {}

  /**
   * Establish a session by verifying a credential.
   *
   * On failure this returns `AuthenticationOutcome.failure()` — the one
   * failure shape — whether the operator does not exist, the secret is
   * wrong, the operator is deactivated, or the source is unavailable. The
   * caller cannot tell them apart, and neither can the HTTP layer.
   */
  async signIn(
    operatorId: OperatorId,
    secret: string,
  ): Promise<AuthenticationOutcome> {
    const verification = await this.provider.verifyCredential(operatorId, secret);

    if (!verification.isVerified()) {
      return AuthenticationOutcome.failure();
    }

    const operator = verification.getOperator();
    if (operator === null) {
      // A verified outcome with no operator is a provider contract
      // violation, but it must not become a distinguishable failure.
      return AuthenticationOutcome.failure();
    }

    if (!operator.isActive()) {
      // A deactivated operator authorises nothing. Treated as a plain
      // failure so the endpoint does not disclose that the identity exists
      // but is disabled.
      return AuthenticationOutcome.failure();
    }

    // The terminal is single-operator: signing in while another session is
    // live ENDS the earlier session. This is a defined policy, not an
    // accident — see the story's edge-case table.
    const now = this.policy.now();
    const existing = await this.sessions.findLiveByOperator(operator.id, now);
    for (const session of existing) {
      await this.sessions.end(session.id, now, SESSION_END_CAUSE_REPLACED);
    }

    const expiresAt = new Date(now.getTime() + this.sessionLifetimeMs);
    const session = await this.sessionFactory.create(operator, now, expiresAt);
    return AuthenticationOutcome.success(session);
  }

  /**
   * End the current session.
   *
   * Idempotent: signing out an already-ended or unknown session is NOT an
   * error, because failing would disclose whether the token was valid.
   */
  async signOut(token: SessionToken): Promise<IdentitySession | null> {
    const session = await this.sessions.findByToken(token);
    if (session === null) {
      return null;
    }
    if (session.isEnded()) {
      return session;
    }
    const now = this.policy.now();
    await this.sessions.end(session.id, now, SESSION_END_CAUSE_SIGNED_OUT);
    return session.end(now, SESSION_END_CAUSE_SIGNED_OUT);
  }

  /**
   * The operator signed in on this token, or null.
   *
   * Returns null for every refusal reason — no session, expired session,
   * ended session, tampered token, deactivated operator. The caller sees
   * "anonymous" in all five cases.
   */
  async currentOperator(token: SessionToken): Promise<Operator | null> {
    const session = await this.currentSession(token);
    if (session === null) {
      return null;
    }
    const operator = await this.operators.findById(session.operatorId);
    if (operator === null || !operator.isActive()) {
      return null;
    }
    return operator;
  }

  /**
   * The current session for a token, or null.
   *
   * Used by the session-inspection endpoint, which reports the session's
   * own fields rather than the operator's.
   */
  async currentSession(token: SessionToken): Promise<IdentitySession | null> {
    const session = await this.sessions.findByToken(token);
    if (session === null) {
      return null;
    }
    if (!this.policy.isLive(session)) {
      return null;
    }
    const operator = await this.operators.findById(session.operatorId);
    if (operator === null || !operator.isActive()) {
      return null;
    }
    return session;
  }

  /** The identity stamp for the current token, or null. */
  async currentStamp(token: SessionToken): Promise<OperatorStamp | null> {
    const operator = await this.currentOperator(token);
    return operator === null ? null : this.stamps.fromOperator(operator);
  }
}
