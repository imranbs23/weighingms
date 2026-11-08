/**
 * ToleranceZone — where the reading sits against the target.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FOUR ZONES, EXACTLY (C-05). AND ONE COMPUTED ZONE FEEDS EVERYTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The status line, the live-weight cell and the progress bar all render the
 * **same** zone — so they cannot disagree (FR-9, BRD FR-16, BRD FR-17). And
 * the zone is computed **in the domain**, and only in the domain: no
 * consumer, in particular no screen, derives it independently.
 *
 * - `OVER`  — the reading is above the tolerance band
 * - `OK`    — the reading is inside the tolerance band
 * - `NEAR`  — the reading is below the band but near the target
 * - `UNDER` — the reading is far below the target
 */
export type ToleranceZone = 'OVER' | 'OK' | 'NEAR' | 'UNDER';

export const TOLERANCE_ZONES: readonly ToleranceZone[] = [
  'OVER',
  'OK',
  'NEAR',
  'UNDER',
];

/**
 * Is this a zone?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint, so
 * a value outside it cannot be written even by a path that bypasses the
 * domain. This guard is how a row is read **back** through the domain.
 */
export function isToleranceZone(value: unknown): value is ToleranceZone {
  return (
    typeof value === 'string' &&
    (TOLERANCE_ZONES as readonly string[]).includes(value)
  );
}
