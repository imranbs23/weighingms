/**
 * SyncBackoffPolicy — the pure rule for when the next attempt is due.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE, AND THE RANDOMNESS IS INJECTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The jitter is a **bounded magnitude** (`jitterMs`), not a random value.
 * The randomness itself is injected as a `random: () => number` source,
 * so the policy stays a pure function of its arguments and the tests are
 * deterministic — `() => 0` gives the base delay exactly.
 *
 * WHY THE BOUND IS IN THE SCHEDULE AND NOT IN THE CODE
 * ---------------------------------------------------
 * An unbounded backoff is a queue that never retries, which is a silent
 * discard with extra steps. The bound is therefore a **required
 * parameter** of the schedule, and the delay is clamped to it.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { BackoffSchedule } from '../value-objects/backoff-schedule.js';

export interface SyncBackoffPolicy {
  /**
   * When the next attempt after `attempts` failures is due.
   *
   * @param attempts  How many attempts have already been made. Zero means
   *                  the next attempt is the first, so the delay is the
   *                  base.
   * @param now       The current time.
   * @param schedule  The configured schedule, carrying the bound.
   * @param random    The injected randomness, in `[0, 1)`.
   */
  nextAttemptAt(
    attempts: number,
    now: Instant,
    schedule: BackoffSchedule,
    random: () => number,
  ): Instant;
}

export class PureSyncBackoffPolicy implements SyncBackoffPolicy {
  nextAttemptAt(
    attempts: number,
    now: Instant,
    schedule: BackoffSchedule,
    random: () => number,
  ): Instant {
    const delayMs = schedule.delayMs(attempts, random);
    return now.plus(Math.round(delayMs));
  }
}
