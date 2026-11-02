/**
 * LinkWatchdog — the pure rule for deciding whether a device has gone
 * silent.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE, NO ENVIRONMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The current time is an ARGUMENT, never read from an ambient source.
 * That is what makes the 2 s boundary testable EXACTLY rather than
 * approximately, and it is the same discipline the identity unit's
 * `AuthorisationPolicy` followed for its expiry boundary.
 *
 * THE BOUNDARY IS INCLUSIVE
 * -------------------------
 * "Within 2 seconds" has NOT been exceeded at exactly 2000 ms, so the
 * link is still UP at exactly 2000 ms and goes DOWN at 2001 ms. This
 * matches `AuthorisationWindow`, which evaluates its expiry boundary the
 * same way — a link that was still up at the instant of the deadline
 * would be up for one instant too many.
 *
 * ADR-012: the SCHEDULER decides WHEN TO ASK; this policy decides THE
 * ANSWER. The rule has exactly one implementation, and it does not depend
 * on timer accuracy.
 */
import { Instant } from '../value-objects/instant.js';

export interface LinkVerdict {
  /** True when the device is still being heard from. */
  readonly isUp: boolean;
  /** The instant the link would be considered down. */
  readonly deadline: Instant;
  /** Milliseconds elapsed since the last activity. */
  readonly elapsedMs: number;
}

export class LinkWatchdog {
  /**
   * @param timeoutMs  The disconnect timeout. IR-13 requires 2000 ms.
   *                    It is a PARAMETER of the rule, not a constant
   *                    buried in a callback, so it is stated in one place.
   */
  constructor(private readonly timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Watchdog timeout must be a positive number of milliseconds');
    }
  }

  /**
   * Has the device gone silent?
   *
   * @param lastActivityAt  The receipt time of the last ACCEPTED reading.
   *                         This is the reference point (S-6) — the
   *                         watchdog measures silence from the reading's
   *                         own receipt time, so a clock adjustment
   *                         cannot spuriously trip or mask it.
   * @param now             The current time.
   */
  evaluate(lastActivityAt: Instant, now: Instant): LinkVerdict {
    const elapsedMs = lastActivityAt.millisecondsUntil(now);
    return {
      isUp: elapsedMs <= this.timeoutMs,
      deadline: lastActivityAt.plus(this.timeoutMs),
      elapsedMs,
    };
  }

  get timeout(): number {
    return this.timeoutMs;
  }
}
