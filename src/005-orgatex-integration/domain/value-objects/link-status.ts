/**
 * LinkStatus — the MES link's three states.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET, AND A TYPE RATHER THAN A STRING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A caller cannot read a status it has not proved. The set is the same
 * shape `posting-state.ts` and `batch-weighing-status.ts` already use,
 * for the same reason: a status that is not in the set is a bug in the
 * caller, and the type system is the cheapest place to catch it.
 *
 * THE STATES ARE NOT A SEVERITY SCALE
 * ----------------------------------
 * Each one has a **defined consequence**, and the consequence is what the
 * state is for:
 *
 *   LINKED     the last contact succeeded
 *              → reads and writes proceed normally
 *   DEGRADED   recent contacts failed, but the last successful snapshot
 *              is still within its freshness window
 *              → reads serve the last snapshot, marked with its age;
 *                writes queue
 *   OFFLINE    the station cannot reach the MES
 *              → reads fail loudly; writes queue; weighing continues
 *
 * WEIGHING CONTINUES IN EVERY STATE. (R-07, BRD NFR-03)
 * `OFFLINE` is a condition of the **link**, not of the station.
 *
 * THIS IS NOT THE SCALE'S LINK STATE
 * ----------------------------------
 * ADR-011 established that the link state is a separate axis from any
 * self-reported device status. The scale's link is derived from readings
 * stopping; this one is derived from contact outcomes. The two are not
 * interchangeable — see the domain model, § "The link state is a property
 * of the boundary, not of a device".
 */
export type LinkStatus = 'LINKED' | 'DEGRADED' | 'OFFLINE';

export const LINK_STATUSES: readonly LinkStatus[] = [
  'LINKED',
  'DEGRADED',
  'OFFLINE',
];

export function isLinkStatus(value: unknown): value is LinkStatus {
  return (
    typeof value === 'string' &&
    (LINK_STATUSES as readonly string[]).includes(value)
  );
}
