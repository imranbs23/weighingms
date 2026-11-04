/**
 * NodeLinkFreshnessScheduler — the production `LinkFreshnessScheduler`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ADR-012, EXTENDED FROM THE SCALE'S WATCHDOG.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scale unit has one timer per device, replaced on every reading.
 * This one has **one timer for the one link**, replaced on every
 * failure.
 *
 * The reasoning is the same as the scale's: the scheduler decides WHEN
 * to ask, and the policy decides the answer. So the boundary's
 * correctness does not depend on the timer's accuracy — the callback
 * re-derives the state with the same pure policy the contact path uses.
 *
 * WHY IT IS NOT UNREF'D
 * ---------------------
 * Unlike the scale's watchdog — which deliberately keeps the process
 * alive while a scale streams — this timer must NOT keep the process
 * alive. The server owns the process's lifetime, and a station that
 * cannot shut down because a freshness deadline is pending would be a
 * station that cannot be restarted cleanly.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkFreshnessScheduler } from '../../domain/ports/link-repositories.js';

export class NodeLinkFreshnessScheduler implements LinkFreshnessScheduler {
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param onError  Called when the callback's promise rejects.
   *
   * The callback is ASYNCHRONOUS — it re-derives the link state, which
   * reads and writes the database. A rejection inside it would
   * otherwise become an **unhandled rejection**, and Node's default
   * behaviour for those is to terminate the process.
   *
   * So the scheduler owns the rejection and reports it, exactly as
   * `SyncRetryWorker` does for a failed tick. A station must not die
   * because a freshness deadline could not be evaluated.
   */
  constructor(private readonly onError?: (error: unknown) => void) {}

  schedule(deadline: Instant, callback: () => void | Promise<void>): void {
    this.cancel();

    const delayMs = Math.max(0, deadline.epochMillis - Date.now());

    this.timer = setTimeout(() => {
      this.timer = null;
      // The callback may be synchronous or asynchronous, and an
      // asynchronous one may reject. Either way the rejection is
      // handled HERE — it is never left floating.
      try {
        const result = callback();
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            this.onError?.(error);
          });
        }
      } catch (error) {
        this.onError?.(error);
      }
    }, delayMs);

    // The deadline must not hold the process open.
    this.timer.unref();
  }

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.cancel();
  }
}
