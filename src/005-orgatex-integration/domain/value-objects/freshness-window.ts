/**
 * FreshnessWindow — the configured duration that separates `DEGRADED`
 * from `OFFLINE`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ZERO IS LEGAL. THAT IS THE POINT OF THE TYPE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge case is explicit:
 *
 * > "The freshness window is configured to zero → the state transitions
 * > from `DEGRADED` to `OFFLINE` on the first failure, because no stale
 * > snapshot is ever fresh enough to serve."
 *
 * So a zero window is a **configured value**, not a degenerate one, and
 * this type refuses to pretend otherwise by treating zero as valid. A
 * validator that rejected zero would make the documented behaviour
 * unreachable.
 *
 * WHY A TYPE AND NOT A RAW NUMBER
 * -------------------------------
 * The window is a **duration**, and a duration that arrives as a bare
 * `number` has no units attached to it. `300000` is three hundred
 * thousand of what? The class names it, and the constructor is the only
 * way in — so the units are stated once, at the boundary.
 *
 * IT IS NOT THE SAME TYPE AS `SnapshotFreshness`
 * ----------------------------------------------
 * Bolt 005's `SnapshotFreshness` is a **marker**: `CURRENT` or `STALE`
 * with an age. This is a **duration**. They are different ideas, and
 * unifying them would edit bolt 005's tree — which needs an ADR (OQ-1).
 *
 * What IS unified is the **number**: one configuration key,
 * `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS`, read once in `orgatex-config.ts`
 * and handed to both.
 */

/**
 * A freshness window.
 *
 * The duration is in milliseconds — a millisecond count, not a weight, so
 * ADR-008's fixed-point rule is not engaged here.
 */
export class FreshnessWindow {
  private constructor(readonly durationMs: number) {}

  /**
   * Build a freshness window.
   *
   * @param durationMs  How old a last known-good may be and still be
   *                    served as stale. **Zero is legal.**
   * @throws when the duration is negative, fractional or not finite.
   */
  static of(durationMs: number): FreshnessWindow {
    if (!Number.isFinite(durationMs)) {
      throw new Error(
        'A freshness window must be a finite number of milliseconds',
      );
    }
    if (durationMs < 0) {
      throw new Error(
        'A freshness window must not be negative — zero is a legal window',
      );
    }
    if (!Number.isInteger(durationMs)) {
      throw new Error(
        'A freshness window must be a whole number of milliseconds',
      );
    }
    return new FreshnessWindow(durationMs);
  }

  /**
   * Is a snapshot of this age still fresh enough to serve?
   *
   * The boundary is **inclusive**: a snapshot exactly `durationMs` old is
   * still servable, and one millisecond older is not. This mirrors
   * `LinkWatchdog`'s inclusive boundary — a link that was still up at the
   * instant of the deadline would be up for one instant too many.
   */
  includes(ageMs: number): boolean {
    return ageMs <= this.durationMs;
  }

  toString(): string {
    return `${this.durationMs}ms`;
  }
}
