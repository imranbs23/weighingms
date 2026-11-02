/**
 * NodeWatchdogScheduler — the production `WatchdogScheduler`.
 *
 * ADR-012. One `setTimeout` per device, replaced on every new reading.
 *
 * WHY ONE TIMER PER DEVICE
 * ------------------------
 * A device streaming at 10 Hz would otherwise accumulate 10,000 timers a
 * second. `schedule` therefore clears the previous timer for the same
 * device before setting a new one.
 *
 * WHY NOT `unref` DISABLED
 * -------------------------
 * The timer is deliberately NOT unref'd: while a scale is streaming, the
 * process should stay alive. The composition root disposes the scheduler
 * on shutdown.
 */
import type { WatchdogScheduler } from '../../domain/ports/watchdog-scheduler.js';
import type { ScaleId } from '../../domain/value-objects/scale-id.js';

export class NodeWatchdogScheduler implements WatchdogScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  schedule(scaleId: ScaleId, at: Date, callback: () => void): void {
    this.cancel(scaleId);

    const delayMs = Math.max(0, at.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(scaleId.value);
      callback();
    }, delayMs);

    this.timers.set(scaleId.value, timer);
  }

  cancel(scaleId: ScaleId): void {
    const existing = this.timers.get(scaleId.value);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(scaleId.value);
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
