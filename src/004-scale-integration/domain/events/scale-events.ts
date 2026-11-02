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
import type { TareState } from '../entities/tare-state.js';
import type { WeighingBlockReason } from '../value-objects/weighing-block-reason.js';
import type { ScaleSelection } from '../entities/scale-selection.js';
import type { WeightValue } from '../value-objects/weight-value.js';
import type { ScaleClass } from '../value-objects/scale-capability.js';

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

export interface TareApplied {
  readonly type: 'TARE_APPLIED';
  readonly scaleId: ScaleId;
  readonly tare: TareState;
}

export interface TareRefused {
  readonly type: 'TARE_REFUSED';
  readonly scaleId: ScaleId;
  readonly reason: WeighingBlockReason;
  readonly at: Date;
  /**
   * The previous tare remains in force (S-14).
   *
   * The event says so explicitly, because a device whose zero reference
   * was silently dropped would report a container's full weight as the
   * dispensed quantity — a plausible wrong number.
   */
  readonly previousTareRetained: true;
}

export interface ScaleSelected {
  readonly type: 'SCALE_SELECTED';
  readonly selection: ScaleSelection;
}

export interface ScaleSelectionRefused {
  readonly type: 'SCALE_SELECTION_REFUSED';
  readonly componentId: ScaleSelection['componentId'];
  readonly target: WeightValue;
  readonly maximumCapacity: WeightValue;
  readonly demandedClass: ScaleClass;
  readonly at: Date;
}

export type ScaleEvent =
  | ScaleDisconnected
  | ScaleReconnected
  | ScaleStatusChanged
  | ReadingRejected
  | TareApplied
  | TareRefused
  | ScaleSelected
  | ScaleSelectionRefused;
