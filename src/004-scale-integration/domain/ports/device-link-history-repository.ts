/**
 * DeviceLinkHistoryRepository — the disconnection gaps.
 *
 * APPEND-ONLY (S-9). A disconnection is recorded as TWO immutable facts —
 * a start and an end — never as a mutable "gap" row. The gap is the
 * PROJECTION of the pair.
 *
 * This is the same reasoning as ADR-006 in the identity unit, where
 * consumption is a separate append-only record rather than a flag on the
 * authorisation. A mutable gap row would mean its content depends on
 * whether anyone had looked at it since.
 *
 * NOTE WHAT IS NOT RECORDED: no weight. A disconnection gap says "there
 * was no reading between these two times" — which is exactly the durable
 * fact that matters for investigation, and it says it without recording a
 * single quantity (ADR-009).
 */
import type { DisconnectionEnded } from '../entities/disconnection-ended.js';
import type { DisconnectionStarted } from '../entities/disconnection-started.js';
import type { ScaleId } from '../value-objects/scale-id.js';

export interface DeviceLinkHistoryRepository {
  appendStarted(record: DisconnectionStarted): Promise<void>;
  appendEnded(record: DisconnectionEnded): Promise<void>;

  /** The recorded gaps for a device, oldest first. */
  listGaps(scaleId: ScaleId): Promise<
    { readonly started: DisconnectionStarted; readonly ended: DisconnectionEnded | null }[]
  >;
}
