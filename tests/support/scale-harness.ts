/**
 * The scale unit's test doubles.
 *
 * THE CLOCK IS INJECTED, ALWAYS
 * -----------------------------
 * Every test that concerns a DEADLINE uses `TestClock`. The 2 s
 * disconnect boundary is the unit's sharpest requirement, and it cannot
 * be tested with a real timer — a `sleep(2000)` is 2000 ms plus jitter
 * plus the time to run the assertion, so the boundary would be tested
 * approximately.
 *
 * The `ManualWatchdogScheduler` is the second half of that: it lets a
 * test fire the deadline WHEN IT CHOOSES, rather than waiting for it.
 */
import { LinkWatchdog } from '../../src/004-scale-integration/domain/services/link-watchdog.js';
import type { WatchdogScheduler } from '../../src/004-scale-integration/domain/ports/watchdog-scheduler.js';
import type { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';

/** A clock the test controls. */
export class TestClock {
  constructor(private current: Date = new Date('2026-10-30T07:00:00.000Z')) {}

  now = (): Date => new Date(this.current.getTime());

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

/**
 * A scheduler the test fires by hand.
 *
 * `schedule` records the deadline and the callback; `fire` runs every
 * callback whose deadline has passed. Nothing happens until the test
 * says so.
 */
export class ManualWatchdogScheduler implements WatchdogScheduler {
  private readonly pending = new Map<string, { at: Date; callback: () => void }>();

  schedule(scaleId: ScaleId, at: Date, callback: () => void): void {
    this.pending.set(scaleId.value, { at, callback });
  }

  cancel(scaleId: ScaleId): void {
    this.pending.delete(scaleId.value);
  }

  dispose(): void {
    this.pending.clear();
  }

  /** The deadline scheduled for a device, if any. */
  deadlineFor(scaleId: ScaleId): Date | null {
    return this.pending.get(scaleId.value)?.at ?? null;
  }

  /** How many timers are pending. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Fire the pending callback for a device, as if the deadline arrived. */
  fire(scaleId: ScaleId): void {
    const entry = this.pending.get(scaleId.value);
    if (entry === undefined) return;
    this.pending.delete(scaleId.value);
    entry.callback();
  }

  /** Fire every pending callback. */
  fireAll(): void {
    for (const [key, entry] of [...this.pending.entries()]) {
      this.pending.delete(key);
      entry.callback();
    }
  }
}

/** A watchdog with the IR-13 timeout. */
export function defaultWatchdog(): LinkWatchdog {
  return new LinkWatchdog(2000);
}
