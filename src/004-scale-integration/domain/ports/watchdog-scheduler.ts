/**
 * WatchdogScheduler — the port that lets the domain be woken at a
 * deadline.
 *
 * ADR-012. This is the FIRST unit in the product with a deadline, so it
 * is the first to need a scheduler. The identity unit needed only a
 * clock.
 *
 * WHY A PORT AND NOT A `setTimeout`
 * ---------------------------------
 * Because the 2 s boundary must be testable EXACTLY. With a real timer,
 * a test cannot place the system at "exactly 2000 ms" — a `sleep(2000)` is
 * 2000 ms plus jitter plus the time to run the assertion. With this port,
 * the test injects a `ManualWatchdogScheduler` and a `TestClock`, fires
 * the deadline when it chooses, and the pure policy decides the answer.
 *
 * The scheduler decides WHEN TO ASK. The policy decides THE ANSWER. That
 * split is what keeps the rule's correctness independent of timer
 * accuracy.
 *
 * ONE TIMER PER DEVICE
 * --------------------
 * A device streaming at 10 Hz would otherwise accumulate 10,000 timers a
 * second. `schedule` therefore CANCELS any timer previously scheduled
 * for the same device.
 */
import type { ScaleId } from '../value-objects/scale-id.js';

export interface WatchdogScheduler {
  /**
   * Run `callback` at `at`.
   *
   * Cancels any timer previously scheduled for the same device.
   */
  schedule(scaleId: ScaleId, at: Date, callback: () => void): void;

  /** Cancel the pending timer for a device, if any. */
  cancel(scaleId: ScaleId): void;

  /** Release any resources. */
  dispose(): void;
}
