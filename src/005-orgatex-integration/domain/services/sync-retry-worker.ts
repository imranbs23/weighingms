/**
 * SyncRetryWorker — the scheduled task that retries the due entries.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE OF TWO TRIGGERS. THE OTHER IS EVENT-DRIVEN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The flush **on recovery** is event-driven: a transition to `LINKED`
 * triggers it immediately, so the queue drains as soon as the link comes
 * back rather than waiting for a tick.
 *
 * This worker is the **periodic** path: it picks up the entries whose
 * backoff has expired, whether or not a recovery ever happened. It is
 * what keeps a queue alive across a link that flickered rather than
 * failed cleanly.
 *
 * WHY IT IS A SEPARATE OBJECT
 * ---------------------------
 * Because a timer that the domain starts is a timer the domain cannot
 * stop. The worker owns the interval; the composition root owns the
 * worker's lifecycle; and the domain owns the rule about *what* is due.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SyncQueueService } from './sync-queue-service.js';

export interface SyncRetryWorkerOptions {
  readonly queue: SyncQueueService;
  readonly intervalMs: number;
  readonly clock: () => Date;
  /** Called when a tick throws, so the failure is visible in the log. */
  readonly onError?: (error: unknown) => void;
}

export class SyncRetryWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SyncRetryWorkerOptions) {}

  /** Start the periodic retry. */
  start(): void {
    if (this.timer !== null) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);

    // The worker must not keep the process alive on its own — the server
    // owns the process's lifetime.
    this.timer.unref();
  }

  /** Stop the periodic retry. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One tick.
   *
   * Public so a test can drive it without waiting for the interval.
   */
  async tick(): Promise<void> {
    const { queue, clock, onError } = this.options;
    try {
      await queue.retryDue(Instant.of(clock()));
    } catch (error) {
      // A failed tick must not kill the worker — the next tick will try
      // again — but it must be visible.
      onError?.(error);
    }
  }

  dispose(): void {
    this.stop();
  }
}
