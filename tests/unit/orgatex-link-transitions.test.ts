/**
 * The link's transitions — the append-only status-change log
 * (bolt 007, R-05).
 *
 * The rule under test is the one the story states: a status **change**
 * records a transition, and an **unchanged** status records nothing.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  linkTransition,
  type LinkTransition,
} from '../../src/005-orgatex-integration/domain/entities/link-transition.js';
import {
  LinkStateService,
} from '../../src/005-orgatex-integration/domain/services/link-state-service.js';
import { PureLinkStatePolicy } from '../../src/005-orgatex-integration/domain/services/link-state-policy.js';
import { FreshnessWindow } from '../../src/005-orgatex-integration/domain/value-objects/freshness-window.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import type {
  LinkContactRepository,
  LinkFreshnessScheduler,
  LinkTransitionRepository,
} from '../../src/005-orgatex-integration/domain/ports/link-repositories.js';
import type {
  LinkObservations,
} from '../../src/005-orgatex-integration/domain/value-objects/link-state.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

/** An in-memory contact repository. */
class StubContacts implements LinkContactRepository {
  observations: LinkObservations = {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    consecutiveFailures: 0,
  };

  async read(): Promise<LinkObservations> {
    return this.observations;
  }

  async recordSuccess(at: Instant): Promise<void> {
    this.observations = {
      lastSuccessAt: at,
      lastFailureAt: this.observations.lastFailureAt,
      lastError: null,
      consecutiveFailures: 0,
    };
  }

  async recordFailure(error: SyncError, at: Instant): Promise<void> {
    this.observations = {
      lastSuccessAt: this.observations.lastSuccessAt,
      lastFailureAt: at,
      lastError: error,
      consecutiveFailures: this.observations.consecutiveFailures + 1,
    };
  }
}

/** An in-memory transition log. */
class StubTransitions implements LinkTransitionRepository {
  readonly appended: LinkTransition[] = [];

  async append(transition: LinkTransition): Promise<void> {
    this.appended.push(transition);
  }

  async findAll(): Promise<LinkTransition[]> {
    return [...this.appended];
  }

  async findMostRecent(): Promise<LinkTransition | null> {
    return this.appended.length === 0
      ? null
      : (this.appended[this.appended.length - 1] as LinkTransition);
  }
}

/** A scheduler that records the deadline and never fires on its own. */
class StubScheduler implements LinkFreshnessScheduler {
  deadline: Instant | null = null;
  callback: (() => void) | null = null;
  cancelled = false;

  schedule(deadline: Instant, callback: () => void): void {
    this.deadline = deadline;
    this.callback = callback;
    this.cancelled = false;
  }

  cancel(): void {
    this.deadline = null;
    this.callback = null;
    this.cancelled = true;
  }

  dispose(): void {
    this.cancel();
  }

  /** Fire the scheduled deadline — the test chooses when. */
  async fire(): Promise<void> {
    const callback = this.callback;
    this.callback = null;
    if (callback !== null) {
      await callback();
    }
  }
}

function build(): {
  contacts: StubContacts;
  transitions: StubTransitions;
  scheduler: StubScheduler;
  service: LinkStateService;
  clock: { now: Date; set: (iso: string) => void };
} {
  const contacts = new StubContacts();
  const transitions = new StubTransitions();
  const scheduler = new StubScheduler();
  const clock = {
    now: T0.toDate(),
    set: (iso: string) => {
      clock.now = new Date(iso);
    },
  };

  const service = new LinkStateService({
    policy: new PureLinkStatePolicy(),
    contacts,
    transitions,
    scheduler,
    freshnessWindow: FreshnessWindow.of(300_000),
    clock: () => clock.now,
  });

  return { contacts, transitions, scheduler, service, clock };
}

describe('linkTransition', () => {
  it('refuses a transition that changes nothing', () => {
    expect(() =>
      linkTransition({
        from: 'LINKED',
        to: 'LINKED',
        occurredAt: T0,
        cause: 'CONTACT_SUCCESS',
      }),
    ).toThrow(/is not a transition/);
  });

  it('builds a real transition', () => {
    const transition = linkTransition({
      from: 'LINKED',
      to: 'DEGRADED',
      occurredAt: T0,
      cause: 'CONTACT_FAILURE',
    });

    expect(transition.from).toBe('LINKED');
    expect(transition.to).toBe('DEGRADED');
  });
});

describe('LinkStateService — the transition log (R-05)', () => {
  it('records a transition when the status CHANGES', async () => {
    const { service, transitions } = build();

    // The station has never contacted the MES, so it starts OFFLINE. The
    // first success is a change — OFFLINE → LINKED — so it records one.
    await service.recordSuccess(T0);
    expect(transitions.appended).toHaveLength(1);
    expect(transitions.appended[0]?.from).toBe('OFFLINE');
    expect(transitions.appended[0]?.to).toBe('LINKED');
    expect(transitions.appended[0]?.cause).toBe('CONTACT_SUCCESS');

    const failure = SyncError.of('UNREACHABLE', 'unreachable', 'detail');
    await service.recordFailure(failure, T0.plus(1000));

    expect(transitions.appended).toHaveLength(2);
    expect(transitions.appended[1]?.from).toBe('LINKED');
    expect(transitions.appended[1]?.to).toBe('DEGRADED');
    expect(transitions.appended[1]?.cause).toBe('CONTACT_FAILURE');
  });

  it('records NOTHING when the status is unchanged — R-05', async () => {
    const { service, transitions } = build();

    await service.recordSuccess(T0);
    const before = transitions.appended.length;

    // A second failure leaves the link DEGRADED — the status did not
    // change, so there is no transition to record.
    const failure = SyncError.of('UNREACHABLE', 'unreachable', 'detail');
    await service.recordFailure(failure, T0.plus(1000));
    await service.recordFailure(failure, T0.plus(2000));

    expect(transitions.appended).toHaveLength(before + 1);
  });

  it('a success cancels the pending freshness deadline', async () => {
    const { service, scheduler } = build();

    await service.recordSuccess(T0);
    expect(scheduler.cancelled).toBe(true);
  });

  it('a failure schedules the deadline at the last success plus the window', async () => {
    const { service, scheduler } = build();

    await service.recordSuccess(T0);
    const failure = SyncError.of('UNREACHABLE', 'unreachable', 'detail');
    await service.recordFailure(failure, T0.plus(1000));

    expect(scheduler.deadline?.epochMillis).toBe(T0.plus(300_000).epochMillis);
  });

  it('the scheduled deadline records the transition to OFFLINE', async () => {
    const { service, transitions, scheduler, clock } = build();

    await service.recordSuccess(T0);
    const failure = SyncError.of('UNREACHABLE', 'unreachable', 'detail');
    await service.recordFailure(failure, T0.plus(1000));

    // The deadline fires well after the window closed.
    clock.set('2026-10-30T08:10:00.000Z');
    await scheduler.fire();

    const last = transitions.appended[transitions.appended.length - 1];
    expect(last?.to).toBe('OFFLINE');
    expect(last?.cause).toBe('FRESHNESS_DEADLINE');
  });

  it('a deadline that fires with NO last success records NOTHING', async () => {
    const { service, transitions, scheduler, clock } = build();

    // A station that has NEVER reached the MES is already OFFLINE. The
    // deadline fires, and there is nothing to transition to — so no
    // transition is recorded. The "before" is derived at the deadline's
    // own moment, which is OFFLINE, so the two agree.
    clock.set('2026-10-30T08:10:00.000Z');
    await scheduler.fire();

    expect(transitions.appended).toHaveLength(0);
  });

  it('a deadline whose last success has GONE records NOTHING', async () => {
    const { service, transitions, scheduler, contacts, clock } = build();

    // A success, then a failure — the failure is what arms the deadline.
    await service.recordSuccess(T0);
    await service.recordFailure(
      SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
      T0.plus(1000),
    );
    expect(scheduler.deadline).not.toBeNull();

    // The last success is then gone from the observations. The
    // deadline's callback derives its "before" from the observations, so
    // it has to fall back to the clock's own instant — and the link is
    // OFFLINE either way, so the deadline records NO transition.
    contacts.observations = {
      ...contacts.observations,
      lastSuccessAt: null,
    };

    const before = transitions.appended.length;

    clock.set('2026-10-30T08:10:00.000Z');
    await scheduler.fire();

    expect(transitions.appended).toHaveLength(before);
  });
});
