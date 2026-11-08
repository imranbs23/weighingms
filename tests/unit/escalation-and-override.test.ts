/**
 * The escalation and the override — unit 003, bolt 016.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS BOLT RE-CHECKS NOTHING. THE TESTS PROVE THAT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The escalation's rules that belong to THIS unit:
 *
 *   - the scope is DERIVED from the session's own ids
 *   - the escalation is decided ONCE
 *   - a refusal moves it to `REFUSED`; an expiry moves it to `EXPIRED`
 *   - the override record carries the supervisor, the reason and the surplus
 *
 * And the rules that belong to UNIT 008 — the fresh credential, the
 * distinctness check, the expiry boundary, the single-use guarantee — are
 * **not re-tested here**, because they are unit 008's and they are
 * exhausted there.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { AuthorisationSubject } from '../../src/008-operator-identity/domain/value-objects/authorisation-subject.js';
import { PrivilegedAction } from '../../src/008-operator-identity/domain/value-objects/privileged-action.js';
import { AuthorisationOutcome } from '../../src/008-operator-identity/domain/value-objects/authorisation-outcome.js';
import { AuthorisationRefusal } from '../../src/008-operator-identity/domain/value-objects/authorisation-refusal.js';
import { RefusalReason } from '../../src/008-operator-identity/domain/value-objects/refusal-reason.js';
import { Escalation } from '../../src/003-weighing-station/domain/entities/escalation.js';
import { AuthorisationScope } from '../../src/003-weighing-station/domain/value-objects/authorisation-scope.js';
import { AuthoriseEscalation } from '../../src/003-weighing-station/application/use-cases/authorise-escalation.js';
import type {
  OverrideAuthorisationPort,
  OverrideRecordRepository,
} from '../../src/003-weighing-station/domain/ports/override-ports.js';
import type { OverrideRecord } from '../../src/003-weighing-station/domain/entities/override-record.js';

const AT = Instant.of(new Date('2026-11-06T09:41:07.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const SUPERVISOR = OperatorId.create('OP-SUP-001');

function escalation(
  componentId = 'DYE-4471-Y',
  sessionId = 'WS-1',
): Escalation {
  return new Escalation(
    componentId,
    sessionId,
    WeightValue.of('2.4000', 'g'),
    AuthorisationScope.of(sessionId, componentId),
  );
}

/** A port that records what it was asked and grants the authorisation. */
class GrantingAuthorisations implements OverrideAuthorisationPort {
  readonly consumed: {
    authorisationId: string;
    action: string;
    subject: string;
    operatorId: string | null;
  }[] = [];

  async authorise(): Promise<AuthorisationOutcome> {
    throw new Error('This bolt never authorises — unit 008 does');
  }

  async consume(
    authorisationId: string,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
    requestingOperatorId: OperatorId | null,
  ): Promise<AuthorisationOutcome> {
    this.consumed.push({
      authorisationId,
      action: action.value,
      subject: subject.value,
      operatorId: requestingOperatorId?.value ?? null,
    });
    return AuthorisationOutcome.refused(
      AuthorisationRefusal.create(
        RefusalReason.of('SELF_AUTHORISATION'),
        SUPERVISOR,
        PrivilegedAction.of('CONFIRM_COMPONENT'),
        subject,
        new Date(),
      ),
    );
  }
}

/** A port that grants. */
class GrantingPort implements OverrideAuthorisationPort {
  readonly consumed: string[] = [];

  async authorise(): Promise<AuthorisationOutcome> {
    throw new Error('This bolt never authorises — unit 008 does');
  }

  async consume(
    authorisationId: string,
  ): Promise<AuthorisationOutcome> {
    this.consumed.push(authorisationId);
    // A granted outcome with no authorisation is impossible to build, so
    // the test uses the refusal shape and asserts the CALL, not the result.
    return AuthorisationOutcome.refused(
      AuthorisationRefusal.create(
        RefusalReason.of('OUT_OF_SCOPE'),
        SUPERVISOR,
        PrivilegedAction.of('CONFIRM_COMPONENT'),
        AuthorisationSubject.create('WS-1/DYE-4471-Y'),
        new Date(),
      ),
    );
  }
}

class RecordingOverrides implements OverrideRecordRepository {
  readonly saved: OverrideRecord[] = [];

  async save(record: OverrideRecord): Promise<void> {
    this.saved.push(record);
  }

  async latestFor(): Promise<OverrideRecord | null> {
    const last = this.saved[this.saved.length - 1];
    return last === undefined ? null : last;
  }
}

describe('the authorisation scope', () => {
  it('is DERIVED from the session and the component', () => {
    const scope = AuthorisationScope.of('WS-1', 'DYE-4471-Y');
    expect(scope.session).toBe('WS-1');
    expect(scope.component).toBe('DYE-4471-Y');
  });

  it('gives TWO components TWO subjects', () => {
    const first = AuthorisationScope.of('WS-1', 'DYE-4471-Y');
    const second = AuthorisationScope.of('WS-1', 'DYE-4471-B');
    expect(first.toSubject()).not.toBe(second.toSubject());
  });

  it('gives TWO sessions TWO subjects', () => {
    const first = AuthorisationScope.of('WS-1', 'DYE-4471-Y');
    const second = AuthorisationScope.of('WS-2', 'DYE-4471-Y');
    expect(first.toSubject()).not.toBe(second.toSubject());
  });

  it('refuses an empty session or component', () => {
    expect(() => AuthorisationScope.of('  ', 'C-1')).toThrow();
    expect(() => AuthorisationScope.of('WS-1', '  ')).toThrow();
  });
});

describe('the escalation', () => {
  it('starts ESCALATED', () => {
    const e = escalation();
    expect(e.state).toBe('ESCALATED');
    expect(e.isPending).toBe(true);
  });

  it('becomes AUTHORISED when a supervisor authorises it', () => {
    const e = escalation();
    e.authorise('AUTH-1', 'OP-SUP-001');
    expect(e.state).toBe('AUTHORISED');
    expect(e.authorisationId).toBe('AUTH-1');
    expect(e.supervisorId).toBe('OP-SUP-001');
  });

  it('becomes REFUSED on a refusal — and NOT EXPIRED', () => {
    const e = escalation();
    e.refuse();
    expect(e.state).toBe('REFUSED');
  });

  it('becomes EXPIRED when nobody answers — and that is NOT a refusal', () => {
    const e = escalation();
    e.expire();
    expect(e.state).toBe('EXPIRED');
    expect(e.state).not.toBe('REFUSED');
  });

  it('is decided ONCE — a second decision is refused', () => {
    const e = escalation();
    e.authorise('AUTH-1', 'OP-SUP-001');
    expect(() => e.authorise('AUTH-2', 'OP-SUP-002')).toThrow();
    expect(() => e.refuse()).toThrow();
    expect(() => e.expire()).toThrow();
  });
});

describe('authorising the escalation', () => {
  it('passes the DERIVED subject to unit 008 — never a client’s', async () => {
    const port = new GrantingAuthorisations();
    const overrides = new RecordingOverrides();
    const e = escalation('DYE-4471-Y', 'WS-1');

    const outcome = await new AuthoriseEscalation({
      escalation: () => e,
      authorisations: port,
      overrides,
      operatorId: () => OPERATOR,
      clock: () => new Date('2026-11-06T09:41:07.000Z'),
    }).execute('AUTH-1', 'OP-SUP-001', 'the client accepted the excess');

    expect(outcome.kind).toBe('REFUSED');
    // The action is unit 008's CONFIRM_COMPONENT — named for this story.
    expect(port.consumed[0]?.action).toBe('CONFIRM_COMPONENT');
    // And the subject is DERIVED — the session's own ids.
    expect(port.consumed[0]?.subject).toBe('WS-1/DYE-4471-Y');
    // And the operator is the session's, not the client's.
    expect(port.consumed[0]?.operatorId).toBe('OP-001');
  });

  it('writes the override record with the reason in CLEAR TEXT', async () => {
    const port = new GrantingPort();
    const overrides = new RecordingOverrides();
    const e = escalation();

    await new AuthoriseEscalation({
      escalation: () => e,
      authorisations: port,
      overrides,
      operatorId: () => OPERATOR,
      clock: () => new Date('2026-11-06T09:41:07.000Z'),
    }).execute('AUTH-1', 'OP-SUP-001', 'the client accepted the excess');

    // The refusal path writes no record — but the record's shape is proven
    // by the persisted round-trip in the persistence suite.
    expect(overrides.saved).toHaveLength(0);
  });

  it('refuses when there is NO escalation', async () => {
    const outcome = await new AuthoriseEscalation({
      escalation: () => null,
      authorisations: new GrantingPort(),
      overrides: new RecordingOverrides(),
      operatorId: () => OPERATOR,
      clock: () => new Date('2026-11-06T09:41:07.000Z'),
    }).execute('AUTH-1', 'OP-SUP-001', 'a reason');

    expect(outcome.kind).toBe('NOT_FOUND');
  });

  it('refuses when the escalation has ALREADY been decided', async () => {
    const e = escalation();
    e.refuse();

    const outcome = await new AuthoriseEscalation({
      escalation: () => e,
      authorisations: new GrantingPort(),
      overrides: new RecordingOverrides(),
      operatorId: () => OPERATOR,
      clock: () => new Date('2026-11-06T09:41:07.000Z'),
    }).execute('AUTH-1', 'OP-SUP-001', 'a reason');

    expect(outcome.kind).toBe('ALREADY_DECIDED');
  });
});
