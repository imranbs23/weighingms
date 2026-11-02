/**
 * DisconnectionEnded — an immutable fact: this device was heard from
 * again, at this time, at this sequence.
 *
 * S-9: append-only.
 *
 * It carries the `startedAt` of the matching `DisconnectionStarted`, so
 * the two facts join into a gap WITHOUT a mutable "gap" row. The gap is
 * the projection of the pair.
 *
 * `resumedAtSequence` is the sequence of the reading that ended the
 * disconnection — and it is STRICTLY GREATER than the sequence of the
 * reading before the gap, because a reading whose sequence is not greater
 * is rejected (S-3) and does not bring the link back.
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ReadingSequence } from '../value-objects/reading-sequence.js';

export class DisconnectionEnded {
  constructor(
    readonly scaleId: ScaleId,
    readonly startedAt: Date,
    readonly endedAt: Date,
    readonly detectedAt: Date,
    readonly resumedAtSequence: ReadingSequence,
  ) {}
}
