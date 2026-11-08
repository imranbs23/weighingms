/**
 * ZoneBoundsCache — the bounds, computed ONCE per component.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BOUNDS ARE A FACT ABOUT THE COMPONENT, AND THEY ARE MEMOISED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The near threshold is a fixed-point multiplication (ADR-037), and the
 * zone is evaluated on **every reading** — ten times a second. So the
 * multiplication is done once per component and **kept**, and every reading
 * is compared against the same three numbers.
 *
 * **Why it matters, beyond the cost.** If the bounds were recomputed per
 * reading, then two calls could differ — and the **same reading** would
 * fall in different zones on different calls. The zone would flicker at the
 * boundary, and the operator would see a weight that is sometimes `NEAR`
 * and sometimes `UNDER` while the scale is perfectly still.
 *
 * **The cache is keyed by the component AND its target**, so a revised
 * target produces new bounds rather than stale ones — and the target is
 * **snapshotted** onto the record anyway (BRD FR-25).
 */
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import { ZoneBounds } from '../value-objects/zone-bounds.js';

export class ZoneBoundsCache {
  private readonly entries = new Map<string, ZoneBounds>();

  /**
   * The bounds for a component.
   *
   * @param componentId The recipe slot.
   * @param target The component's target.
   * @param tolerance The band around it — `null` means the MES expressed
   *   none.
   */
  get(
    componentId: string,
    target: WeightValue,
    band: Tolerance | null,
  ): ZoneBounds {
    // The key carries the target and the band, so a revised target produces
    // NEW bounds rather than stale ones.
    const key = `${componentId}|${target.text}|${target.unit}|${
      band === null ? '-' : `${band.min.text}:${band.max.text}`
    }`;

    const found = this.entries.get(key);
    if (found !== undefined) return found;

    const computed = ZoneBounds.of(target, band);
    this.entries.set(key, computed);
    return computed;
  }

  /** Forget everything. A new component's bounds are computed afresh. */
  clear(): void {
    this.entries.clear();
  }
}
