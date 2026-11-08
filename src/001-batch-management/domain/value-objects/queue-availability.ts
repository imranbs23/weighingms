/**
 * QueueAvailability — is there a queue for this station to show?
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO VALUES, NOT THREE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The obvious third value is `STALE` — unit 005 has one. It is rejected
 * because **the operator cannot act on it**. The operator's question is
 * *"can I start work from this list?"*, and the answer is yes or no.
 *
 * Unit 005's three-valued vocabulary answers a different question: *"is
 * this the MES's current answer?"* — which is for the link state and the
 * log. A stale queue that unit 005 still considers serveable **is** work
 * to act on, with its age shown; a stale queue that unit 005 refused is
 * **not**.
 *
 * So `AVAILABLE` covers both a current read and a degraded read that unit
 * 005 decided was serveable — and the **age travels with it**, inside the
 * queue's `freshness`. The operator sees the age; they are not asked to
 * interpret a three-valued state.
 *
 * AND THE EMPTY QUEUE IS NOT AN ERROR
 * -----------------------------------
 * A queue with zero batches is `AVAILABLE`. The MES answered, and the
 * answer was "nothing is released". That is a fact.
 *
 * This matters because the failure case looks superficially similar: both
 * produce zero rows on screen. The difference is that one of them is
 * **silent**, and the operator cannot tell "there is no work" from "the
 * MES is unreachable". `UNAVAILABLE` is what keeps those apart.
 */
import type { StationBatchQueue } from '../entities/station-batch-queue.js';
import type { FilterableStatuses } from './queue-filter.js';

/**
 * Why there is no queue to show.
 *
 * Unit 005's own vocabulary, carried **unchanged**. The codes are closed:
 * `NOT_FOUND` cannot occur here — the queue is a list, and "no batches" is
 * an empty queue, not a missing one.
 */
export type QueueUnavailableReason = 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT';

/**
 * The outcome of asking for the queue.
 *
 * A **union, never a thrown error** for an expected condition. An
 * unreachable MES is a NORMAL condition of this product — BRD FR-20
 * requires the station to keep working through one — and modelling it as
 * an exception would make every caller handle it, and the caller that
 * forgot would turn a recoverable outage into an outage with a crash on
 * top.
 */
export type QueueAvailability =
  | {
      readonly kind: 'AVAILABLE';
      readonly queue: StationBatchQueue;
      /**
       * The statuses **present in the queue**, and therefore the statuses
       * the operator may filter to (ADR-030).
       *
       * Carried on the availability rather than computed at the call site,
       * so every caller publishes the same option set and no caller can
       * forget it.
       */
      readonly statuses: FilterableStatuses;
    }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly reason: QueueUnavailableReason;
      /**
       * The **diagnostic**, for the log — never for the client
       * (BRD IR-09).
       *
       * The API response carries the reason code and nothing else; the
       * detail goes to the log, where it can be diagnosed without
       * OrgaTEX-side access.
       */
      readonly message: string;
    };
