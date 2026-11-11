/**
 * RecordedTare — the tare a weighing used, as the record carries it.
 *
 * Copied at confirmation from this session's container assignment (unit
 * 002), so a past weighing can be reconstructed from its own record
 * (BRD BR-14, ADR-048). It is never supplied by a client, and the device's
 * own zero is not one (ADR-015).
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

export type RecordedTareSource = 'CONTAINER_MASTER' | 'WEIGHED_EMPTY_CONTAINER';

export const RECORDED_TARE_SOURCES: readonly RecordedTareSource[] = [
  'CONTAINER_MASTER',
  'WEIGHED_EMPTY_CONTAINER',
];

export function isRecordedTareSource(value: unknown): value is RecordedTareSource {
  return (
    typeof value === 'string' &&
    (RECORDED_TARE_SOURCES as readonly string[]).includes(value)
  );
}

export interface RecordedTare {
  /** The tare's weight, in the unit unit 002 recorded it in. */
  readonly weight: WeightValue;
  /** How the tare was established. */
  readonly source: RecordedTareSource;
}
