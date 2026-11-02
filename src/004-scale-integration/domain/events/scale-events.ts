/**
 * The domain events of the scale unit.
 *
 * WHAT IS NOT AN EVENT
 * --------------------
 * There is no `ReadingAccepted`. A reading arrives ten times a second per
 * device, and it is CONSUMED by the stream, not RECORDED. Making it an
 * event would mean ten events a second flowing through a publisher that
 * nothing durable subscribes to.
 *
 * This is the same distinction ADR-006 drew in the identity unit: **what
 * is recorded and what is merely broadcast are different things**, and
 * only the rare, durable facts become events.
 *
 * The events here are the transitions — a disconnection, a reconnection, a
 * status change — plus one diagnostic that fires per REJECTED reading
 * rather than per accepted one, because a misbehaving device should be
 * visible.
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ScaleStatus } from '../value-objects/scale-status.js';
import type { ReadingSequence } from '../value-objects/reading-sequence.js';

export interface ScaleDisconnected {
  readonly type: 'SCALE_DISCONNECTED';
  readonly scaleId: ScaleId;
  readonly startedAt: Date;
  readonly detectedAt: Date;
  readonly lastSequence: ReadingSequence | null;
}

export interface ScaleReconnected {
  readonly type: 'SCALE_RECONNECTED';
  readonly scaleId: ScaleId;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly detectedAt: Date;
  readonly resumedAtSequence: ReadingSequence;
}

export interface ScaleStatusChanged {
  readonly type: 'SCALE_STATUS_CHANGED';
  readonly scaleId: ScaleId;
  readonly from: ScaleStatus;
  readonly to: ScaleStatus;
  readonly at: Date;
}

export interface ReadingRejected {
  readonly type: 'READING_REJECTED';
  readonly scaleId: ScaleId;
  readonly rejectedSequence: ReadingSequence;
  readonly lastAcceptedSequence: ReadingSequence | null;
  readonly at: Date;
}

export type ScaleEvent =
  | ScaleDisconnected
  | ScaleReconnected
  | ScaleStatusChanged
  | ReadingRejected;
