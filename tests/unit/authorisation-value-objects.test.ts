/**
 * Unit tests for the authorisation value objects — the type-level invariants.
 *
 * These are the tests that prove A-1 … A-6 are STRUCTURAL rather than
 * conventional. If someone later adds a way to build a `SupervisorAuthorisation`
 * without a reason, or a `RefusalReason` outside the closed set, these tests
 * are the tripwire.
 */
import { describe, it, expect } from 'vitest';
import { PrivilegedAction } from '../../src/008-operator-identity/domain/value-objects/privileged-action.js';
import {
  PRIVILEGED_ACTION_NAMES,
  PRIVILEGED_ACTION_CONFIRM_COMPONENT,
  PRIVILEGED_ACTION_TOLERANCE_OVERRIDE,
  PRIVILEGED_ACTION_MANUAL_SCALE_RESELECTION,
  PRIVILEGED_ACTION_CALIBRATION_BYPASS,
} from '../../src/008-operator-identity/domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../src/008-operator-identity/domain/value-objects/authorisation-subject.js';
import { AuthorisationReason } from '../../src/008-operator-identity/domain/value-objects/authorisation-reason.js';
import { AuthorisationScope } from '../../src/008-operator-identity/domain/value-objects/authorisation-scope.js';
import { AuthorisationWindow } from '../../src/008-operator-identity/domain/value-objects/authorisation-window.js';
import { AuthorisationOutcome } from '../../src/008-operator-identity/domain/value-objects/authorisation-outcome.js';
import { AuthorisationRefusal } from '../../src/008-operator-identity/domain/value-objects/authorisation-refusal.js';
import {
  RefusalReason,
  REFUSAL_REASONS,
  REFUSAL_SELF_AUTHORISATION,
  REFUSAL_EXPIRED,
} from '../../src/008-operator-identity/domain/value-objects/refusal-reason.js';
import { SessionId } from '../../src/008-operator-identity/domain/value-objects/session-id.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { SupervisorAuthorisation } from '../../src/008-operator-identity/domain/entities/supervisor-authorisation.js';

describe('PrivilegedAction', () => {
  it('carries exactly the four privileged actions the requirements name', () => {
    // FR-21 names three (tolerance override, manual scale reselection,
    // calibration bypass). Unit 003's story 007 names the fourth.
    // If this set changes, the database CHECK constraint must change with it.
    expect(PRIVILEGED_ACTION_NAMES).toEqual([
      'CONFIRM_COMPONENT',
      'TOLERANCE_OVERRIDE',
      'MANUAL_SCALE_RESELECTION',
      'CALIBRATION_BYPASS',
    ]);
  });

  it('refuses to reconstruct an action outside the closed set', () => {
    // Defaulting here would silently widen the authorisation surface.
    expect(() => PrivilegedAction.fromStored('DELETE_EVERYTHING')).toThrow(
      /Unknown privileged action/,
    );
  });

  it('round-trips a stored action', () => {
    const action = PrivilegedAction.fromStored(PRIVILEGED_ACTION_TOLERANCE_OVERRIDE);
    expect(action.value).toBe(PRIVILEGED_ACTION_TOLERANCE_OVERRIDE);
  });

  it('compares exactly — case differences are different actions', () => {
    expect(
      PrivilegedAction.of(PRIVILEGED_ACTION_CONFIRM_COMPONENT).equals(
        PrivilegedAction.of('confirm_component' as 'CONFIRM_COMPONENT'),
      ),
    ).toBe(false);
  });
});

describe('AuthorisationSubject', () => {
  it('trims surrounding whitespace', () => {
    expect(AuthorisationSubject.create('  comp-1  ').value).toBe('comp-1');
  });

  it('rejects an empty subject', () => {
    expect(() => AuthorisationSubject.create('   ')).toThrow();
  });

  it('rejects an over-long subject', () => {
    expect(() => AuthorisationSubject.create('x'.repeat(257))).toThrow();
  });

  it('compares exactly', () => {
    expect(
      AuthorisationSubject.create('comp-1').equals(AuthorisationSubject.create('COMP-1')),
    ).toBe(false);
  });

  it('refuses to reconstruct a blank stored subject', () => {
    // A blank subject that matched everything would be a scope hole.
    expect(() => AuthorisationSubject.fromStored('')).toThrow();
  });
});

describe('AuthorisationReason', () => {
  it('trims surrounding whitespace', () => {
    expect(AuthorisationReason.create('  approved per QC  ').value).toBe('approved per QC');
  });

  it('rejects an empty reason', () => {
    expect(() => AuthorisationReason.create('')).toThrow(/must not be empty/);
  });

  it('rejects a whitespace-only reason', () => {
    expect(() => AuthorisationReason.create('   \t  ')).toThrow();
  });

  it('rejects a punctuation-only reason', () => {
    // "!!!" records the APPEARANCE of a justification while providing none.
    expect(() => AuthorisationReason.create('!!! ...')).toThrow(/letter or a digit/);
  });

  it('accepts a short but meaningful reason', () => {
    // A length minimum would reject legitimate short justifications.
    expect(AuthorisationReason.create('ok').value).toBe('ok');
  });

  it('accepts a non-Latin justification', () => {
    // The rule is "contains a letter or a digit", not "contains ASCII".
    expect(AuthorisationReason.create('khách duyệt').value).toBe('khách duyệt');
  });

  it('rejects an over-long reason', () => {
    expect(() => AuthorisationReason.create('x'.repeat(1001))).toThrow();
  });

  it('refuses to reconstruct a meaningless stored reason', () => {
    expect(() => AuthorisationReason.fromStored('...')).toThrow();
  });
});

describe('AuthorisationScope', () => {
  const action = PrivilegedAction.of(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
  const otherAction = PrivilegedAction.of(PRIVILEGED_ACTION_TOLERANCE_OVERRIDE);
  const subject = AuthorisationSubject.create('comp-1');
  const otherSubject = AuthorisationSubject.create('comp-2');

  it('matches on BOTH action and subject', () => {
    const scope = AuthorisationScope.of(action, subject);
    expect(scope.matches(action, subject)).toBe(true);
  });

  it('does NOT match on the action alone', () => {
    // A scope that matched the action alone would authorise every subject
    // of that action.
    const scope = AuthorisationScope.of(action, subject);
    expect(scope.matches(action, otherSubject)).toBe(false);
  });

  it('does NOT match on the subject alone', () => {
    // A scope that matched the subject alone would authorise every action
    // of that subject.
    const scope = AuthorisationScope.of(action, subject);
    expect(scope.matches(otherAction, subject)).toBe(false);
  });

  it('compares equal scopes as equal', () => {
    const a = AuthorisationScope.of(action, subject);
    const b = AuthorisationScope.of(action, subject);
    expect(a.equals(b)).toBe(true);
  });
});

describe('AuthorisationWindow', () => {
  const start = new Date('2026-10-30T08:00:00.000Z');

  it('expires after the lifetime', () => {
    const window = AuthorisationWindow.startingAt(start, 60_000);
    expect(window.expiresAt.getTime()).toBe(start.getTime() + 60_000);
  });

  it('is live one millisecond before expiry', () => {
    const window = AuthorisationWindow.startingAt(start, 60_000);
    expect(window.isLiveAt(new Date(start.getTime() + 59_999))).toBe(true);
  });

  it('is EXPIRED at exactly the expiry instant', () => {
    // The boundary is INCLUSIVE — an authorisation live for one instant
    // too many is a bug.
    const window = AuthorisationWindow.startingAt(start, 60_000);
    expect(window.isLiveAt(new Date(start.getTime() + 60_000))).toBe(false);
    expect(window.isExpiredAt(new Date(start.getTime() + 60_000))).toBe(true);
  });

  it('is expired after the expiry instant', () => {
    const window = AuthorisationWindow.startingAt(start, 60_000);
    expect(window.isLiveAt(new Date(start.getTime() + 60_001))).toBe(false);
  });

  it('rejects a window that expires before it was authorised', () => {
    expect(() =>
      AuthorisationWindow.of(new Date('2026-10-30T09:00:00.000Z'), start),
    ).toThrow(/must expire after/);
  });

  it('rejects a non-positive lifetime', () => {
    expect(() => AuthorisationWindow.startingAt(start, 0)).toThrow(/positive/);
    expect(() => AuthorisationWindow.startingAt(start, -1)).toThrow(/positive/);
    expect(() => AuthorisationWindow.startingAt(start, Number.NaN)).toThrow(/positive/);
  });
});

describe('RefusalReason', () => {
  it('has a closed set of reasons', () => {
    // Every value corresponds to one of the story's refusal cases.
    expect(REFUSAL_REASONS.length).toBe(12);
  });

  it('refuses to reconstruct a reason outside the closed set', () => {
    expect(() => RefusalReason.fromStored('WHATEVER')).toThrow(/Unknown refusal reason/);
  });

  it('round-trips a stored reason', () => {
    expect(RefusalReason.fromStored(REFUSAL_EXPIRED).value).toBe(REFUSAL_EXPIRED);
  });

  it('compares by value', () => {
    expect(
      RefusalReason.of(REFUSAL_SELF_AUTHORISATION).equals(
        RefusalReason.of(REFUSAL_SELF_AUTHORISATION),
      ),
    ).toBe(true);
  });
});

describe('SessionId', () => {
  it('trims and accepts a normal id', () => {
    expect(SessionId.create('  ses-1  ').value).toBe('ses-1');
  });

  it('rejects an empty id', () => {
    expect(() => SessionId.create('   ')).toThrow();
  });

  it('rejects an over-long id', () => {
    expect(() => SessionId.create('x'.repeat(65))).toThrow();
  });
});

describe('AuthorisationOutcome', () => {
  const subject = AuthorisationSubject.create('comp-1');
  const action = PrivilegedAction.of(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
  const authorisation = new SupervisorAuthorisation(
    'auth-1',
    SessionId.create('ses-1'),
    OperatorId.create('SV-001'),
    OperatorId.create('OP-001'),
    action,
    subject,
    AuthorisationReason.create('approved'),
    AuthorisationWindow.startingAt(new Date('2026-10-30T08:00:00.000Z'), 60_000),
  );

  it('reports a granted outcome', () => {
    const outcome = AuthorisationOutcome.granted(authorisation);
    expect(outcome.isGranted()).toBe(true);
    expect(outcome.isRefused()).toBe(false);
    expect(outcome.isConsumed()).toBe(false);
    expect(outcome.getAuthorisation()).toBe(authorisation);
  });

  it('reports a refused outcome', () => {
    const refusal = AuthorisationRefusal.create(
      RefusalReason.of(REFUSAL_EXPIRED),
      OperatorId.create('OP-001'),
      action,
      subject,
      new Date(),
    );
    const outcome = AuthorisationOutcome.refused(refusal);
    expect(outcome.isRefused()).toBe(true);
    expect(outcome.isGranted()).toBe(false);
    expect(outcome.getRefusal()).toBe(refusal);
  });
});

describe('AuthorisationRefusal', () => {
  it('carries the reason, actor, action and subject', () => {
    // The four things the story requires a refusal to be audited with.
    const actor = OperatorId.create('OP-001');
    const action = PrivilegedAction.of(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
    const subject = AuthorisationSubject.create('comp-1');
    const at = new Date('2026-10-30T08:00:00.000Z');

    const refusal = AuthorisationRefusal.create(
      RefusalReason.of(REFUSAL_EXPIRED),
      actor,
      action,
      subject,
      at,
    );

    expect(refusal.reason.value).toBe(REFUSAL_EXPIRED);
    expect(refusal.actor?.value).toBe('OP-001');
    expect(refusal.action?.value).toBe(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
    expect(refusal.subject?.value).toBe('comp-1');
    expect(refusal.occurredAt).toBe(at);
  });

  it('allows a null actor — there may be no signed-in operator at all', () => {
    const refusal = AuthorisationRefusal.create(
      RefusalReason.of(REFUSAL_EXPIRED),
      null,
      null,
      null,
      new Date(),
    );
    expect(refusal.actor).toBeNull();
  });
});

describe('SupervisorAuthorisation', () => {
  const action = PrivilegedAction.of(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
  const subject = AuthorisationSubject.create('comp-1');
  const start = new Date('2026-10-30T08:00:00.000Z');

  const authorisation = new SupervisorAuthorisation(
    'auth-1',
    SessionId.create('ses-1'),
    OperatorId.create('SV-001'),
    OperatorId.create('OP-001'),
    action,
    subject,
    AuthorisationReason.create('approved'),
    AuthorisationWindow.startingAt(start, 60_000),
  );

  it('exposes its scope', () => {
    expect(authorisation.scope.action.value).toBe(PRIVILEGED_ACTION_CONFIRM_COMPONENT);
    expect(authorisation.scope.subject.value).toBe('comp-1');
  });

  it('exposes its window', () => {
    expect(authorisation.authorisedAt).toBe(start);
    expect(authorisation.expiresAt.getTime()).toBe(start.getTime() + 60_000);
  });

  it('is live before expiry and expired AT expiry', () => {
    expect(authorisation.isLiveAt(new Date(start.getTime() + 59_999))).toBe(true);
    expect(authorisation.isLiveAt(new Date(start.getTime() + 60_000))).toBe(false);
  });

  it('is in scope only for its own action AND subject', () => {
    expect(authorisation.isInScope(action, subject)).toBe(true);
    expect(
      authorisation.isInScope(PrivilegedAction.of(PRIVILEGED_ACTION_TOLERANCE_OVERRIDE), subject),
    ).toBe(false);
    expect(
      authorisation.isInScope(action, AuthorisationSubject.create('comp-2')),
    ).toBe(false);
  });

  it('is distinct from a DIFFERENT operator', () => {
    // A-1: checked on identity, never on role.
    expect(authorisation.isDistinctFrom(OperatorId.create('OP-001'))).toBe(true);
  });

  it('is NOT distinct from the same operator — even a supervisor', () => {
    // The self-authorisation case. A person holding both roles still
    // cannot authorise their own escalation.
    expect(authorisation.isDistinctFrom(OperatorId.create('SV-001'))).toBe(false);
  });
});
