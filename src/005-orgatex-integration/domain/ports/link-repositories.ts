/**
 * The link's ports — its observations, its transitions, its deadline and
 * the rejection disposition.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ABSENT METHODS ARE THE ENFORCEMENT. (Again.)
 * ══════════════════════════════════════════════════════════════════════
 *
 * | Repository | Absent | The rule it enforces |
 * |---|---|---|
 * | `LinkContactRepository` | no `setStatus` | The row holds the **observations**, never the derived status. A persisted status would be a second source of truth that could disagree with the derivation. |
 * | `LinkTransitionRepository` | no `update`, no `delete` | A transition is a fact about the past. Rewriting history would make the transition record useless for the diagnosis it exists to serve. |
 *
 * WHY A SCHEDULER PORT
 * --------------------
 * ADR-012: *"The scheduler decides when to ask. The policy decides the
 * answer."*
 *
 * A polled link state would be **wrong by up to a poll interval** at
 * exactly the moment it matters — the snapshot's freshness window
 * expiring. The station would keep serving a stale schedule for up to a
 * poll interval after the window closed.
 *
 * So the deadline is **scheduled**, and the port is what makes the
 * boundary testable exactly: a test injects a manual scheduler and fires
 * the deadline when it chooses, and the pure policy decides the answer.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkTransition } from '../entities/link-transition.js';
import type { LinkObservations } from '../value-objects/link-state.js';
import type { SyncError } from '../value-objects/sync-error.js';
import type { RejectionDisposition } from '../../infrastructure/config/orgatex-config.js';

/**
 * The link's observations — one row.
 *
 * It holds what was **observed**, never what was concluded.
 */
export interface LinkContactRepository {
  read(): Promise<LinkObservations>;

  /** A contact succeeded: the streak resets to zero and the error clears. */
  recordSuccess(at: Instant): Promise<void>;

  /** A contact failed: the streak grows and the error is recorded. */
  recordFailure(error: SyncError, at: Instant): Promise<void>;
}

/**
 * The transition log — append-only.
 */
export interface LinkTransitionRepository {
  append(transition: LinkTransition): Promise<void>;

  /** Every transition, oldest first. */
  findAll(): Promise<LinkTransition[]>;

  findMostRecent(): Promise<LinkTransition | null>;
}

/**
 * The deadline scheduler.
 *
 * There is **one** link, so there is **one** timer — unlike the scale
 * unit, which has one per device. `cancel` takes no argument because
 * there is nothing to distinguish.
 */
export interface LinkFreshnessScheduler {
  /**
   * Run `callback` at `deadline`. Replaces any pending deadline.
   *
   * The callback may be asynchronous — it re-derives the link state, which
   * reads and writes the database. A scheduler that discards the returned
   * promise would turn a rejection into an **unhandled rejection**, and
   * Node terminates the process on those by default.
   */
  schedule(deadline: Instant, callback: () => void | Promise<void>): void;

  /** Cancel the pending deadline, if any. */
  cancel(): void;

  /** Release any resources. */
  dispose(): void;
}

/**
 * The rejection disposition — configuration, consumed not re-decided.
 *
 * ADR-026 made it a configuration value defaulting to `RETRYABLE`, and
 * explicitly left the decision of *what to do next* to this bolt.
 */
export interface RejectionDispositionReader {
  disposition(): RejectionDisposition;
}

/**
 * The narrow port the MES-contacting paths use to report an outcome.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY A PORT AND NOT THE SERVICE ITSELF
 * ══════════════════════════════════════════════════════════════════════
 *
 * `LinkStateService` is the **single writer** of the observation row
 * (OQ-5), but the readers — bolt 005's `BatchQueueReader` and
 * `RecipeReader` — must not depend on the whole service to report a
 * contact. A dependency on the service would drag the scheduler, the
 * transition repository and the freshness window into a read path that
 * does not use them.
 *
 * So the readers depend on **this** — two methods — and the composition
 * root binds the service to it.
 *
 * It is optional on the readers, so a reader can be built without a link
 * reporter at all — which is what the existing bolt 005 tests do.
 */
export interface LinkContactReporter {
  /** The MES was reached and answered. */
  recordSuccess(at: Instant): Promise<void>;

  /** The MES was reached and refused, or could not be reached at all. */
  recordFailure(error: SyncError, at: Instant): Promise<void>;
}
