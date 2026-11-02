/**
 * TareState — the device's CURRENT ZERO REFERENCE.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THE TARE IS
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tare is the weight the device subtracts from its gross reading, so
 * that the reading reflects only what was dispensed into the container.
 *
 * It is a PROPERTY OF THE DEVICE, not of a consumer and not of a
 * container. That is why it is a member of the `ScaleDevice` aggregate
 * rather than a separate thing: a tare means nothing without the device
 * it belongs to, and two devices may hold different tares at the same
 * time.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NEVER PERSISTED (ADR-015)
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no `TareRepository` and the `scale_devices` table gains no
 * tare column. A stale tare read back after a restart would be a WRONG
 * NUMBER, not an inconvenience: the scale would report net weight
 * against a container that is no longer on it, and the operator would
 * have no way to know. The ABSENCE of a repository is the enforcement —
 * the mistake requires deliberately inventing a table, rather than
 * copying a pattern from a neighbouring unit.
 *
 * ══════════════════════════════════════════════════════════════════════
 * IMMUTABLE, AND REPLACED RATHER THAN MUTATED
 * ══════════════════════════════════════════════════════════════════════
 *
 * A re-tare REPLACES the previous tare; it never adds to it and never
 * edits it in place. The state that was in force is therefore never
 * silently rewritten — a refusal (S-14) leaves it exactly as it was, and
 * a successful re-tare swaps it for a new one that carries its own
 * applied time and source.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TARE MAY BE EXACTLY ZERO — AND THAT IS NOT "NO TARE" (S-12)
 * ══════════════════════════════════════════════════════════════════════
 *
 * A tare of zero is a real decision ("this container weighs nothing") and
 * is recorded with its source. "No tare in force" is a DIFFERENT fact,
 * and it is represented by the ABSENCE of a tare state — not by a tare
 * whose value happens to be zero.
 */
import { ScaleId } from '../value-objects/scale-id.js';
import { WeightValue } from '../value-objects/weight-value.js';
import type { Instant } from '../value-objects/instant.js';
import type { TareSource } from '../value-objects/tare-source.js';
import type { TareMechanism } from '../value-objects/tare-mechanism.js';

export class TareState {
  constructor(
    readonly scaleId: ScaleId,
    /** The tare value, in the DEVICE's unit. */
    readonly tareValue: WeightValue,
    /** When the tare was applied. */
    readonly appliedAt: Instant,
    /** Where the value came from. */
    readonly source: TareSource,
    /** Where the tare was applied — the indicator, or the software. */
    readonly appliedBy: TareMechanism,
  ) {}

  /** The unit the tare is expressed in — the device's own unit. */
  get unit(): string {
    return this.tareValue.unit;
  }
}
