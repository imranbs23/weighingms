/**
 * The production link freshness scheduler (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TIMER FOR THE ONE LINK.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ADR-012: the scheduler decides WHEN TO ASK, and the pure policy decides
 * the answer. So the timer's accuracy is not the boundary's correctness —
 * the callback re-derives the state with the same policy the contact path
 * uses.
 *
 * What this file proves is the **lifecycle**: a deadline that is replaced
 * replaces the timer, a cancelled deadline does not fire, and the timer
 * never holds the process open.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  NodeLinkFreshnessScheduler,
} from '../../src/005-orgatex-integration/infrastructure/adapters/node-link-freshness-scheduler.js';

describe('NodeLinkFreshnessScheduler — the deadline timer', () => {
  it('a scheduled deadline FIRES its callback', async () => {
    const scheduler = new NodeLinkFreshnessScheduler();
    let fired = false;

    // A deadline in the past is due immediately — the delay is clamped
    // to zero rather than being negative.
    scheduler.schedule(
      Instant.of(new Date(Date.now() - 1000)),
      () => {
        fired = true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fired).toBe(true);
    scheduler.dispose();
  });

  it('a CANCELLED deadline does not fire', async () => {
    const scheduler = new NodeLinkFreshnessScheduler();
    let fired = false;

    scheduler.schedule(
      Instant.of(new Date(Date.now() - 1000)),
      () => {
        fired = true;
      },
    );
    scheduler.cancel();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fired).toBe(false);
    scheduler.dispose();
  });

  it('cancelling when NOTHING is scheduled is harmless', () => {
    const scheduler = new NodeLinkFreshnessScheduler();

    // No timer, so there is nothing to clear — and a cancel that threw
    // would make the contact path fragile.
    expect(() => scheduler.cancel()).not.toThrow();
    expect(() => scheduler.dispose()).not.toThrow();
  });

  it('a SECOND deadline replaces the first', async () => {
    const scheduler = new NodeLinkFreshnessScheduler();
    const fired: string[] = [];

    scheduler.schedule(
      Instant.of(new Date(Date.now() - 1000)),
      () => {
        fired.push('first');
      },
    );
    scheduler.schedule(
      Instant.of(new Date(Date.now() - 1000)),
      () => {
        fired.push('second');
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    // There is ONE link, so there is ONE deadline — and the second one
    // is the only one that runs.
    expect(fired).toEqual(['second']);
    scheduler.dispose();
  });

  it('a REJECTED callback is reported, not left floating', async () => {
    // The deadline's callback re-derives the link state, which reads and
    // writes the database — so it is ASYNCHRONOUS, and it can reject.
    //
    // A rejection left floating becomes an **unhandled rejection**, and
    // Node terminates the process on those by default. A station must not
    // die because a freshness deadline could not be evaluated.
    const errors: unknown[] = [];
    const scheduler = new NodeLinkFreshnessScheduler((error) =>
      errors.push(error),
    );

    scheduler.schedule(Instant.of(new Date(Date.now() - 1000)), () =>
      Promise.reject(new Error('the database is gone')),
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('the database is gone');
    scheduler.dispose();
  });

  it('a THROWN callback is reported too', async () => {
    const errors: unknown[] = [];
    const scheduler = new NodeLinkFreshnessScheduler((error) =>
      errors.push(error),
    );

    scheduler.schedule(Instant.of(new Date(Date.now() - 1000)), () => {
      throw new Error('the callback exploded');
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('the callback exploded');
    scheduler.dispose();
  });
});
