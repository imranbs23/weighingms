/**
 * LinkStatePolicy — the pure rule for deriving the MES link's state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE, NO ENVIRONMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The current time is an **argument**, never read from an ambient source.
 * That is what makes the freshness boundary testable **exactly** rather
 * than approximately, and it is the same discipline `LinkWatchdog` and
 * the identity unit's `AuthorisationPolicy` both followed.
 *
 * ADR-012: the SCHEDULER decides WHEN TO ASK; this policy decides THE
 * ANSWER. The rule has exactly one implementation, and it does not depend
 * on timer accuracy.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { FreshnessWindow } from '../value-objects/freshness-window.js';
import type {
  LinkObservations,
  LinkState,
} from '../value-objects/link-state.js';

export interface LinkStatePolicy {
  derive(
    observations: LinkObservations,
    now: Instant,
    window: FreshnessWindow,
  ): LinkState;
}

export class PureLinkStatePolicy implements LinkStatePolicy {
  derive(
    observations: LinkObservations,
    now: Instant,
    window: FreshnessWindow,
  ): LinkState {
    // ── LINKED ─────────────────────────────────────────────────────────
    // The last contact succeeded — and there WAS one.
    //
    // The second condition is the one that is easy to miss. A station
    // that has never contacted the MES has no failures either, because
    // it has made no attempts. Its streak is zero, and a rule that read
    // only the streak would call it LINKED — a station that believes it
    // is connected to a MES it has never spoken to.
    if (
      observations.consecutiveFailures === 0 &&
      observations.lastSuccessAt !== null
    ) {
      return {
        status: 'LINKED',
        lastContactAt: observations.lastSuccessAt,
        lastError: observations.lastError,
        consecutiveFailures: 0,
      };
    }

    // ── DEGRADED ───────────────────────────────────────────────────────
    // The last contact failed, a last successful contact exists, and it
    // is still within its freshness window.
    //
    // The second condition is the one that is easy to miss. A snapshot
    // taken before the link went down is still the best information
    // available — but a snapshot taken before a DIFFERENT outage, an hour
    // ago, from a link that had already been failing, is not "the last
    // successful snapshot", it is an old one. The freshness window bounds
    // how old that may be.
    //
    // A WINDOW OF ZERO MAKES DEGRADED UNREACHABLE. (R-06)
    // The story is explicit: "the state transitions from DEGRADED to
    // OFFLINE on the first failure, because no stale snapshot is ever
    // fresh enough to serve."
    //
    // So the zero is checked **explicitly**, rather than left to the
    // inclusive boundary. A snapshot of age zero is technically within a
    // zero window — but a zero window is a **configuration**, and the
    // operator who set it asked for a link that fails visibly at once.
    // Leaving it to the boundary would make the documented behaviour
    // reachable only by accident.
    if (observations.lastSuccessAt !== null && window.durationMs > 0) {
      const ageMs = observations.lastSuccessAt.millisecondsUntil(now);
      if (window.includes(ageMs)) {
        return {
          status: 'DEGRADED',
          lastContactAt: observations.lastSuccessAt,
          lastError: observations.lastError,
          consecutiveFailures: observations.consecutiveFailures,
        };
      }
    }

    // ── OFFLINE ────────────────────────────────────────────────────────
    // Everything else — including "never contacted successfully".
    //
    // A station that has never reached the MES is OFFLINE, not LINKED and
    // not DEGRADED: DEGRADED requires a last successful contact, and
    // there is none.
    return {
      status: 'OFFLINE',
      lastContactAt: observations.lastSuccessAt,
      lastError: observations.lastError,
      consecutiveFailures: observations.consecutiveFailures,
    };
  }
}
