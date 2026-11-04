/**
 * BackoffSchedule — the bounded retry policy, as configuration.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BOUND IS THE PART THAT MATTERS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `maxMs` is the bound on the wait between attempts, and an **unbounded**
 * backoff is a queue that never retries — which is a silent discard with
 * extra steps. A backoff that grows without a ceiling is not patience;
 * it is a queue that has given up while still claiming to be trying.
 *
 * So the bound is a **required** parameter, and `maxMs < baseMs` is
 * refused: a schedule whose bound is below its own base could never make
 * a first attempt in a legal delay.
 *
 * EVERY PARAMETER IS A PARAMETER OF A RULE
 * ----------------------------------------
 * BRD NFR-14: how long to wait before retrying is an **operational**
 * question, not a developer's. So every number here is configuration, and
 * none is buried in an implementation.
 */

/**
 * A bounded backoff schedule.
 *
 * The delay for attempt `n` is:
 *
 *   raw      = baseMs × multiplier^(n − 1)
 *   jittered = raw + random() × jitterMs
 *   delay    = min(maxMs, jittered)
 *
 * The jitter is a **bounded magnitude**, not a random value — the
 * randomness itself is injected, so the policy stays pure (OQ-3).
 */
export class BackoffSchedule {
  private constructor(
    readonly baseMs: number,
    readonly maxMs: number,
    readonly multiplier: number,
    readonly jitterMs: number,
  ) {}

  static of(
    baseMs: number,
    maxMs: number,
    multiplier: number,
    jitterMs: number,
  ): BackoffSchedule {
    if (!Number.isFinite(baseMs) || baseMs <= 0) {
      throw new Error('A backoff base must be a positive number of milliseconds');
    }
    if (!Number.isFinite(maxMs) || maxMs < baseMs) {
      throw new Error(
        'A backoff bound must be at least as large as its base — an unbounded backoff is a queue that never retries',
      );
    }
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      throw new Error('A backoff multiplier must be at least 1');
    }
    if (!Number.isFinite(jitterMs) || jitterMs < 0) {
      throw new Error('A backoff jitter must be a non-negative number of milliseconds');
    }
    return new BackoffSchedule(baseMs, maxMs, multiplier, jitterMs);
  }

  /** The default schedule — the values `orgatex-config.ts` falls back to. */
  static defaults(): BackoffSchedule {
    return BackoffSchedule.of(1000, 300000, 2, 250);
  }

  /**
   * The delay before the attempt after `attempts` have been made.
   *
   * @param attempts  How many attempts have already been made. Zero means
   *                  the next attempt is the **first**, so the delay is the
   *                  base.
   * @param random    The injected randomness, in `[0, 1)`. Injecting it
   *                  keeps the policy pure and the tests deterministic.
   */
  delayMs(attempts: number, random: () => number): number {
    if (!Number.isInteger(attempts) || attempts < 0) {
      throw new Error('The attempt count must be a non-negative whole number');
    }
    const exponent = Math.max(0, attempts - 1);
    const raw = this.baseMs * Math.pow(this.multiplier, exponent);
    const jittered = raw + random() * this.jitterMs;
    return Math.min(this.maxMs, jittered);
  }
}
