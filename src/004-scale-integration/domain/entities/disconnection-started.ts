/**
 * DisconnectionStarted — an immutable fact: this device stopped being
 * heard from, at this time.
 *
 * S-9: append-only. Never updated, never deleted.
 *
 * TWO TIMES, NOT ONE
 * ------------------
 *   `startedAt`  — when the device STOPPED being heard from. This is the
 *                  receipt time of its last accepted reading, or the
 *                  time it was registered if it never spoke at all.
 *   `detectedAt` — when the WATCHDOG noticed, which is `startedAt` plus
 *                  the timeout.
 *
 * They are different facts, and conflating them would misstate the
 * detection latency the requirement is about: IR-13 requires detection
 * within 2 s, and `detectedAt − startedAt` is exactly that latency.
 *
 * A device that NEVER spoke has no `startedAt` from a reading — it has
 * the registration time. And it produces NO `DisconnectionStarted` at
 * all, because a gap needs a start and a device that never spoke has no
 * gap (ADR-011).
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ReadingSequence } from '../value-objects/reading-sequence.js';

export type DisconnectionReason = 'SILENCE';

export class DisconnectionStarted {
  constructor(
    readonly scaleId: ScaleId,
    readonly startedAt: Date,
    readonly detectedAt: Date,
    readonly lastSequence: ReadingSequence | null,
    readonly reason: DisconnectionReason,
  ) {}
}
