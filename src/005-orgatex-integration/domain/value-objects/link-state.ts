/**
 * LinkState — the MES link's current condition, and the observations it
 * is derived from.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DERIVED, NEVER STORED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This type holds the **observations** — the last successful contact, the
 * last failure, the failure count — and the status those observations
 * imply. The status is **recomputed** from the observations on every read
 * by `LinkStatePolicy`, and it is never persisted.
 *
 * A persisted status would be a second source of truth: it would have to
 * be updated on every path that can change the link — the posting path,
 * the read path, the queue's delivery, the scheduled deadline — and every
 * path that forgets is a path that reports the wrong state to the
 * operator.
 *
 * THE OBJECT IS IMMUTABLE
 * -----------------------
 * A contact outcome produces a **new** `LinkState`; nothing mutates the
 * current one. That is the same discipline `ConsumptionPosting` follows —
 * `accept` and `reject` return new instances rather than changing
 * themselves in place.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkStatus } from './link-status.js';
import type { SyncError } from './sync-error.js';

/**
 * The observations the status is derived from.
 *
 * This is what the `link_contact_observations` row holds — and it holds
 * **this**, not a `LinkState`.
 */
export interface LinkObservations {
  /** The last **successful** contact; null until one occurs. */
  readonly lastSuccessAt: Instant | null;
  /** The last failed contact. */
  readonly lastFailureAt: Instant | null;
  /** The last failure's bounded diagnostic; null when there is none. */
  readonly lastError: SyncError | null;
  /** Failures since the last success. Reset to zero on a success. */
  readonly consecutiveFailures: number;
}

/**
 * The link's current state.
 *
 * `lastContactAt` is the time of the last **successful** contact — the
 * name is the story's own, and it is null when the station has never
 * contacted the MES successfully.
 */
export interface LinkState {
  readonly status: LinkStatus;
  readonly lastContactAt: Instant | null;
  readonly lastError: SyncError | null;
  readonly consecutiveFailures: number;
}

/**
 * The observations a station has before it has ever contacted the MES.
 *
 * A station that has never reached the MES is `OFFLINE`, with no
 * last-contact time and no snapshot served — and this is that state,
 * written down once.
 */
export const EMPTY_OBSERVATIONS: LinkObservations = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  consecutiveFailures: 0,
};
