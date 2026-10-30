/**
 * SessionPolicy — pure session lifetime rules.
 *
 * NO I/O, no dependencies. Every rule here is a pure function of the
 * session and the current time, which makes the expiry boundary directly
 * testable without a clock, a database or a server.
 *
 * THE BOUNDARY IS INCLUSIVE: at exactly `expiresAt` the session is EXPIRED.
 * This matters. The story says "the session expires exactly at `expiresAt`
 * ... expiry is evaluated at the boundary, not after it". A session that
 * was still live at the instant of expiry would be live for one instant
 * too many.
 */
import type { IdentitySession } from '../entities/identity-session.js';

export class SessionPolicy {
  constructor(private readonly clock: () => Date) {}

  now(): Date {
    return this.clock();
  }

  /** True when the session has passed its expiry instant. */
  isExpired(session: IdentitySession, at: Date = this.now()): boolean {
    return at.getTime() >= session.expiresAt.getTime();
  }

  /** True when the session has been explicitly ended. */
  isEnded(session: IdentitySession): boolean {
    return session.isEnded();
  }

  /**
   * True when the session authorises something.
   *
   * A session authorises only if it is not ended AND not expired. Note
   * that this says nothing about whether the OPERATOR is still active —
   * that check belongs to the caller, because it needs the operator.
   */
  isLive(session: IdentitySession, at: Date = this.now()): boolean {
    return !this.isEnded(session) && !this.isExpired(session, at);
  }

  /** Milliseconds remaining, or 0 if already expired. */
  remainingLifetime(session: IdentitySession, at: Date = this.now()): number {
    const remaining = session.expiresAt.getTime() - at.getTime();
    return remaining > 0 ? remaining : 0;
  }
}
