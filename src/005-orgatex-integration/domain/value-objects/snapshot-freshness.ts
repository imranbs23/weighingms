/**
 * SnapshotFreshness — the rule that makes "never stale-as-current"
 * structural.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE ARE ONLY TWO STATES, AND ONE OF THEM IS STALE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A snapshot is either CURRENT — fetched in this call, age zero — or STALE,
 * carrying the age it actually is. There is **no third state** in which a
 * stale snapshot is indistinguishable from a fresh one.
 *
 * The age is measured against the snapshot's own `receivedAt`, so this type
 * needs no second timestamp: it holds the duration, and the snapshot holds
 * the point it is measured from.
 *
 * WHY THIS IS A TYPE AND NOT A BOOLEAN
 * ------------------------------------
 * A boolean `stale: true` is one bit, and a bit can be dropped. A
 * discriminated union cannot be dropped, because reading `ageMs` off a
 * CURRENT freshness is a **type error** rather than an `undefined` at
 * runtime. The failure mode of a missing freshness marker is that a
 * consumer cannot tell a stale snapshot from a current one — and the
 * consequence of that is a schedule from an hour ago presented as the one
 * production just released.
 */
export type SnapshotFreshness =
  | { readonly kind: 'CURRENT' }
  | { readonly kind: 'STALE'; readonly ageMs: number };

export const CURRENT: SnapshotFreshness = { kind: 'CURRENT' };

/**
 * A stale snapshot's age.
 *
 * `ageMs` is a **duration**, not a quantity — a millisecond count, not a
 * weight — so it is a JSON number on the wire. ADR-008's rule is about
 * *quantities*; making a duration a string would be a second convention
 * for no reason.
 */
export function stale(ageMs: number): SnapshotFreshness {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    throw new Error('A stale snapshot age must be a non-negative number of milliseconds');
  }
  return { kind: 'STALE', ageMs };
}
