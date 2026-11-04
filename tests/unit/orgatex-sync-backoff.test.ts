/**
 * The bounded backoff (R-15).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BOUND IS THE ASSERTION THAT MATTERS
 * ══════════════════════════════════════════════════════════════════════
 *
 * A backoff that grows without a ceiling is not patience — it is a queue
 * that has given up while still claiming to be trying. So the schedule's
 * `maxMs` is a **required** parameter, and the delay is clamped to it no
 * matter how many attempts have failed.
 *
 * The jitter is injected, so every number in this file is exact.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { BackoffSchedule } from '../../src/005-orgatex-integration/domain/value-objects/backoff-schedule.js';
import { PureSyncBackoffPolicy } from '../../src/005-orgatex-integration/domain/services/sync-backoff-policy.js';

const T0 = Instant.of(new Date('2026-11-03T09:00:00.000Z'));

/** A deterministic randomness — the jitter's magnitude, not a value. */
const NO_JITTER = (): number => 0;
const FULL_JITTER = (): number => 1;

describe('BackoffSchedule — the schedule is configuration', () => {
  it('refuses a base that is not positive', () => {
    expect(() => BackoffSchedule.of(0, 1000, 2, 0)).toThrow();
    expect(() => BackoffSchedule.of(-1, 1000, 2, 0)).toThrow();
    expect(() => BackoffSchedule.of(Number.NaN, 1000, 2, 0)).toThrow();
  });

  it('refuses a bound BELOW the base — the schedule could never make an attempt', () => {
    expect(() => BackoffSchedule.of(1000, 999, 2, 0)).toThrow();
  });

  it('refuses a multiplier below 1 — the delay would shrink as attempts grow', () => {
    expect(() => BackoffSchedule.of(1000, 60_000, 0, 0)).toThrow();
  });

  it('refuses a negative jitter', () => {
    expect(() => BackoffSchedule.of(1000, 60_000, 2, -1)).toThrow();
  });

  it('the defaults are the ones the configuration falls back to', () => {
    const schedule = BackoffSchedule.defaults();
    expect(schedule.baseMs).toBe(1000);
    expect(schedule.maxMs).toBe(300000);
    expect(schedule.multiplier).toBe(2);
    expect(schedule.jitterMs).toBe(250);
  });
});

describe('BackoffSchedule — the delay grows', () => {
  const schedule = BackoffSchedule.of(1000, 60_000, 2, 0);

  it('the FIRST attempt waits the base', () => {
    expect(schedule.delayMs(0, NO_JITTER)).toBe(1000);
    expect(schedule.delayMs(1, NO_JITTER)).toBe(1000);
  });

  it('each attempt multiplies the delay', () => {
    expect(schedule.delayMs(1, NO_JITTER)).toBe(1000);
    expect(schedule.delayMs(2, NO_JITTER)).toBe(2000);
    expect(schedule.delayMs(3, NO_JITTER)).toBe(4000);
    expect(schedule.delayMs(4, NO_JITTER)).toBe(8000);
  });

  it('refuses a negative or fractional attempt count', () => {
    expect(() => schedule.delayMs(-1, NO_JITTER)).toThrow();
    expect(() => schedule.delayMs(1.5, NO_JITTER)).toThrow();
  });
});

describe('BackoffSchedule — the delay is BOUNDED (R-15)', () => {
  it('never waits longer than the bound, however many attempts have failed', () => {
    const schedule = BackoffSchedule.of(1000, 60_000, 2, 0);

    for (const attempts of [1, 5, 10, 50, 100, 1000]) {
      expect(schedule.delayMs(attempts, NO_JITTER)).toBeLessThanOrEqual(60_000);
    }
  });

  it('the delay is EXACTLY the bound once the growth would pass it', () => {
    const schedule = BackoffSchedule.of(1000, 60_000, 2, 0);

    // 1000 × 2^6 = 64000 — past the bound, so it is clamped.
    expect(schedule.delayMs(7, NO_JITTER)).toBe(60_000);
    expect(schedule.delayMs(100, NO_JITTER)).toBe(60_000);
  });
});

describe('BackoffSchedule — the jitter is a bounded MAGNITUDE', () => {
  const schedule = BackoffSchedule.of(1000, 60_000, 2, 250);

  it('adds NO jitter when the randomness is zero', () => {
    expect(schedule.delayMs(1, NO_JITTER)).toBe(1000);
  });

  it('adds the FULL jitter when the randomness is one', () => {
    expect(schedule.delayMs(1, FULL_JITTER)).toBe(1250);
  });

  it('the jitter NEVER pushes the delay past the bound', () => {
    const bounded = BackoffSchedule.of(1000, 1100, 2, 250);

    // The raw delay plus the full jitter is 1250 — past the bound of 1100.
    expect(bounded.delayMs(1, FULL_JITTER)).toBe(1100);
  });
});

describe('PureSyncBackoffPolicy — the next attempt time', () => {
  const policy = new PureSyncBackoffPolicy();
  const schedule = BackoffSchedule.of(1000, 60_000, 2, 0);

  it('the next attempt is the base delay from now', () => {
    const next = policy.nextAttemptAt(0, T0, schedule, NO_JITTER);
    expect(next.epochMillis).toBe(T0.plus(1000).epochMillis);
  });

  it('the next attempt grows with the attempt count', () => {
    const next = policy.nextAttemptAt(3, T0, schedule, NO_JITTER);
    expect(next.epochMillis).toBe(T0.plus(4000).epochMillis);
  });

  it('the next attempt is BOUNDED — it is always in the future, never never', () => {
    const bounded = BackoffSchedule.of(1000, 10_000, 2, 0);

    for (const attempts of [1, 10, 100, 1000]) {
      const next = policy.nextAttemptAt(attempts, T0, bounded, NO_JITTER);
      expect(next.epochMillis).toBeGreaterThan(T0.epochMillis);
      expect(next.epochMillis).toBeLessThanOrEqual(
        T0.plus(10_000).epochMillis,
      );
    }
  });

  it('the policy is PURE — the same inputs give the same answer', () => {
    const first = policy.nextAttemptAt(2, T0, schedule, NO_JITTER);
    const second = policy.nextAttemptAt(2, T0, schedule, NO_JITTER);
    expect(first.epochMillis).toBe(second.epochMillis);
  });
});
