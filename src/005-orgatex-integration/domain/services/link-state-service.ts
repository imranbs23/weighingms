/**
 * LinkStateService — the **single writer** of the MES link's observations.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE WRITER. NO HEALTH PROBE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every MES contact outcome — the posting path's, the read path's, the
 * queue's delivery — reports through this service. There is one writer of
 * the observation row, and **no separate health probe**.
 *
 * A probe would be a second writer, and a second opinion about the same
 * boundary from a different request than the one the operator's last
 * action produced. The link state answers *"can we reach the MES right
 * now?"* — and the honest answer comes from the outcomes of the calls
 * the station actually made.
 *
 * THE STATUS IS DERIVED, NEVER STORED
 * -----------------------------------
 * The row holds the **observations**. The status is recomputed by the
 * same pure policy on every read and after every observation, so the
 * stored row and the reported status cannot disagree.
 *
 * THE "BEFORE" STATE IS READ BEFORE THE WRITE
 * --------------------------------------------
 * The transition's `from` is the status as it was **before** this
 * contact. So the previous status has to be derived from the
 * observations *before* they are updated — reading them afterwards would
 * make every transition a self-transition, and a self-transition is not a
 * transition.
 *
 * THE SCHEDULED DEADLINE USES THE SAME POLICY
 * --------------------------------------------
 * When a contact fails, the service schedules the freshness deadline. The
 * scheduled callback re-derives the status with the **same** policy the
 * contact path uses, so the two paths cannot disagree (ADR-012).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkTransition } from '../entities/link-transition.js';
import { linkTransition } from '../entities/link-transition.js';
import type { LinkEvent } from '../events/link-events.js';
import type {
  LinkContactRepository,
  LinkFreshnessScheduler,
  LinkTransitionRepository,
} from '../ports/link-repositories.js';
import type { LinkStatePolicy } from './link-state-policy.js';
import type { FreshnessWindow } from '../value-objects/freshness-window.js';
import type { LinkState } from '../value-objects/link-state.js';
import type { SyncError } from '../value-objects/sync-error.js';

export interface LinkStateServiceOptions {
  readonly policy: LinkStatePolicy;
  readonly contacts: LinkContactRepository;
  readonly transitions: LinkTransitionRepository;
  readonly scheduler: LinkFreshnessScheduler;
  readonly freshnessWindow: FreshnessWindow;
  readonly clock: () => Date;
  readonly onEvent?: (event: LinkEvent) => void;
}

export class LinkStateService {
  constructor(private readonly options: LinkStateServiceOptions) {}

  /**
   * Record a **successful** contact.
   *
   * The streak resets to zero, the last error clears, and the status
   * becomes `LINKED`. A transition is recorded only if the status
   * actually changed.
   */
  async recordSuccess(at: Instant): Promise<LinkState> {
    const { contacts, policy, freshnessWindow, scheduler } = this.options;

    // The status as it was BEFORE this contact.
    const before = policy.derive(
      await contacts.read(),
      at,
      freshnessWindow,
    );

    await contacts.recordSuccess(at);

    const after = policy.derive(
      await contacts.read(),
      at,
      freshnessWindow,
    );

    await this.recordTransitionIfChanged(before, after, at, 'CONTACT_SUCCESS');

    // The link is healthy, so the deadline is moot.
    scheduler.cancel();

    return after;
  }

  /**
   * Record a **failed** contact.
   *
   * The streak grows, the error is recorded, and the freshness deadline
   * is scheduled at `lastSuccessAt + freshnessWindow`.
   */
  async recordFailure(error: SyncError, at: Instant): Promise<LinkState> {
    const { contacts, policy, freshnessWindow, scheduler } = this.options;

    // The status as it was BEFORE this contact.
    const before = policy.derive(
      await contacts.read(),
      at,
      freshnessWindow,
    );

    await contacts.recordFailure(error, at);

    const observations = await contacts.read();
    const after = policy.derive(observations, at, freshnessWindow);

    await this.recordTransitionIfChanged(before, after, at, 'CONTACT_FAILURE');

    // The deadline is measured from the last SUCCESSFUL contact, so a
    // snapshot that ages out is the one that stops being served — not the
    // one that failed last.
    if (observations.lastSuccessAt !== null) {
      const deadline = observations.lastSuccessAt.plus(
        freshnessWindow.durationMs,
      );
      scheduler.schedule(deadline, () => this.onFreshnessDeadline());
    }

    return after;
  }

  /**
   * The current link state.
   *
   * Derived on every read, from the observations.
   */
  async read(): Promise<LinkState> {
    const { contacts, policy, freshnessWindow, clock } = this.options;
    const observations = await contacts.read();
    return policy.derive(observations, Instant.of(clock()), freshnessWindow);
  }

  /**
   * The transition log, oldest first.
   */
  async transitionLog(): Promise<LinkTransition[]> {
    return this.options.transitions.findAll();
  }

  /**
   * The freshness deadline has been reached.
   *
   * The snapshot has aged out of its window. The status is re-derived
   * with the **same** pure policy, so a link whose last contact was
   * successful and recent enough is unaffected — the deadline fires, but
   * the answer is still `DEGRADED` or `LINKED`.
   */
  private async onFreshnessDeadline(): Promise<void> {
    const { contacts, policy, freshnessWindow, clock, transitions } =
      this.options;

    const at = Instant.of(clock());
    const observations = await contacts.read();

    // The status as it was **when the deadline was scheduled** — that is,
    // as it was at the last successful contact plus the window. The
    // deadline is the moment the snapshot stops being servable, so the
    // "before" is the status **at** that moment.
    //
    // Deriving both from the same instant would make them identical by
    // construction, and the transition could never be recorded.
    const before = policy.derive(
      observations,
      observations.lastSuccessAt?.plus(freshnessWindow.durationMs) ?? at,
      freshnessWindow,
    );

    const after = policy.derive(observations, at, freshnessWindow);

    if (before.status === after.status) {
      // Nothing changed — the deadline fired but the link is still
      // healthy, or still as broken as it was. No transition (R-05).
      return;
    }

    const transition = linkTransition({
      from: before.status,
      to: after.status,
      occurredAt: at,
      cause: 'FRESHNESS_DEADLINE',
    });
    await transitions.append(transition);
    this.emit({
      type: 'LINK_STATE_CHANGED',
      from: transition.from,
      to: transition.to,
      occurredAt: at.toDate(),
      cause: transition.cause,
    });
  }

  /**
   * Record a transition — but only when the status actually changed.
   *
   * "The link changed" and "something happened" are different claims, and
   * a transition that records no change would make the log useless for
   * the diagnosis it exists to serve.
   */
  private async recordTransitionIfChanged(
    before: LinkState,
    after: LinkState,
    at: Instant,
    cause: 'CONTACT_SUCCESS' | 'CONTACT_FAILURE',
  ): Promise<void> {
    if (before.status === after.status) {
      return;
    }

    const transition = linkTransition({
      from: before.status,
      to: after.status,
      occurredAt: at,
      cause,
    });

    await this.options.transitions.append(transition);
    this.emit({
      type: 'LINK_STATE_CHANGED',
      from: transition.from,
      to: transition.to,
      occurredAt: at.toDate(),
      cause: transition.cause,
    });
  }

  private emit(event: LinkEvent): void {
    this.options.onEvent?.(event);
  }
}
