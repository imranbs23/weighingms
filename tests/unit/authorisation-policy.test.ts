/**
 * Unit tests for the authorisation POLICY — the pure rules.
 *
 * `AuthorisationPolicy` has no I/O, no clock and no database: the current
 * time is an ARGUMENT. That is what makes the expiry boundary testable
 * EXACTLY rather than approximately, and what lets this file exhaust every
 * rule without a single fixture.
 *
 * The unit brief requires that "the checks live behind ONE interface in this
 * unit, so they can be exhausted exhaustively by tests rather than
 * re-implemented at each call site" — this file is that exhaustion.
 */
import { describe, it, expect } from 'vitest';
import { AuthorisationPolicy } from '../../src/008-operator-identity/domain/services/authorisation-policy.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { PrivilegedAction } from '../../src/008-operator-identity/domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../src/008-operator-identity/domain/value-objects/authorisation-subject.js';
import { AuthorisationReason } from '../../src/008-operator-identity/domain/value-objects/authorisation-reason.js';
import { AuthorisationWindow } from '../../src/008-operator-identity/domain/value-objects/authorisation-window.js';
import { SessionId } from '../../src/008-operator-identity/domain/value-objects/session-id.js';
import {
  REFUSAL_ALREADY_USED,
  REFUSAL_EXPIRED,
  REFUSAL_OUT_OF_SCOPE,
  REFUSAL_ROLE_NOT_SUPERVISOR,
  REFUSAL_SELF_AUTHORISATION,
} from '../../src/008-operator-identity/domain/value-objects/refusal-reason.js';
import { SupervisorAuthorisation } from '../../src/008-operator-identity/domain/entities/supervisor-authorisation.js';

const policy = new AuthorisationPolicy();

const action = PrivilegedAction.of('CONFIRM_COMPONENT');
const otherAction = PrivilegedAction.of('TOLERANCE_OVERRIDE');
const subject = AuthorisationSubject.create('comp-1');
const otherSubject = AuthorisationSubject.create('comp-2');

const start = new Date('2026-10-30T08:00:00.000Z');
const LIFETIME = 60_000;

function makeAuthorisation(
  overrides: {
    action?: PrivilegedAction;
    subject?: AuthorisationSubject;
    authorisedAt?: Date;
    lifetimeMs?: number;
  } = {},
): SupervisorAuthorisation {
  return new SupervisorAuthorisation(
    'auth-1',
    SessionId.create('ses-1'),
    OperatorId.create('SV-001'),
    OperatorId.create('OP-001'),
    overrides.action ?? action,
    overrides.subject ?? subject,
    AuthorisationReason.create('approved for testing'),
    AuthorisationWindow.startingAt(overrides.authorisedAt ?? start, overrides.lifetimeMs ?? LIFETIME),
  );
}

describe('AuthorisationPolicy.mayAuthorise', () => {
  it('permits a supervisor authorising for a different operator', () => {
    const reason = policy.mayAuthorise(
      OperatorRole.supervisor(),
      OperatorId.create('SV-001'),
      OperatorId.create('OP-001'),
    );
    expect(reason).toBeNull();
  });

  it('permits a supervisor authorising when no operator is signed in', () => {
    // The story's edge case: no signed-in operator is refused LATER, at
    // the point of use. Creating an authorisation is still legitimate.
    const reason = policy.mayAuthorise(
      OperatorRole.supervisor(),
      OperatorId.create('SV-001'),
      null,
    );
    expect(reason).toBeNull();
  });

  it('refuses SELF authorisation — the supervisor is the requesting operator', () => {
    const reason = policy.mayAuthorise(
      OperatorRole.supervisor(),
      OperatorId.create('SV-001'),
      OperatorId.create('SV-001'),
    );
    expect(reason?.value).toBe(REFUSAL_SELF_AUTHORISATION);
  });

  it('refuses self authorisation even when the person holds BOTH roles', () => {
    // The check is on IDENTITY, never on role.
    const reason = policy.mayAuthorise(
      OperatorRole.supervisor(),
      OperatorId.create('SV-001'),
      OperatorId.create('SV-001'),
    );
    expect(reason?.value).toBe(REFUSAL_SELF_AUTHORISATION);
  });

  it('refuses an authoriser who is not a supervisor', () => {
    const reason = policy.mayAuthorise(
      OperatorRole.operator(),
      OperatorId.create('OP-002'),
      OperatorId.create('OP-001'),
    );
    expect(reason?.value).toBe(REFUSAL_ROLE_NOT_SUPERVISOR);
  });

  it('reports SELF_AUTHORISATION before ROLE_NOT_SUPERVISOR', () => {
    // The order matters because the reason is AUDITED — it must name the
    // FIRST thing that was wrong, and the identity fact is more fundamental.
    const reason = policy.mayAuthorise(
      OperatorRole.operator(),
      OperatorId.create('OP-001'),
      OperatorId.create('OP-001'),
    );
    expect(reason?.value).toBe(REFUSAL_SELF_AUTHORISATION);
  });
});

describe('AuthorisationPolicy.isLive', () => {
  it('is live one millisecond before expiry', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isLive(authorisation, new Date(start.getTime() + LIFETIME - 1))).toBe(true);
  });

  it('is NOT live at exactly the expiry instant', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isLive(authorisation, new Date(start.getTime() + LIFETIME))).toBe(false);
  });

  it('is NOT live after expiry', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isLive(authorisation, new Date(start.getTime() + LIFETIME + 1))).toBe(false);
  });
});

describe('AuthorisationPolicy.isInScope', () => {
  it('is in scope for its own action and subject', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isInScope(authorisation, action, subject)).toBe(true);
  });

  it('is out of scope for a different action', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isInScope(authorisation, otherAction, subject)).toBe(false);
  });

  it('is out of scope for a different subject', () => {
    const authorisation = makeAuthorisation();
    expect(policy.isInScope(authorisation, action, otherSubject)).toBe(false);
  });
});

describe('AuthorisationPolicy.evaluate', () => {
  it('permits a live, in-scope, unspent authorisation', () => {
    const authorisation = makeAuthorisation();
    const reason = policy.evaluate(
      authorisation,
      action,
      subject,
      new Date(start.getTime() + 1000),
      false,
    );
    expect(reason).toBeNull();
  });

  it('refuses an out-of-scope authorisation', () => {
    const authorisation = makeAuthorisation();
    const reason = policy.evaluate(
      authorisation,
      otherAction,
      subject,
      new Date(start.getTime() + 1000),
      false,
    );
    expect(reason?.value).toBe(REFUSAL_OUT_OF_SCOPE);
  });

  it('refuses an expired authorisation', () => {
    const authorisation = makeAuthorisation();
    const reason = policy.evaluate(
      authorisation,
      action,
      subject,
      new Date(start.getTime() + LIFETIME),
      false,
    );
    expect(reason?.value).toBe(REFUSAL_EXPIRED);
  });

  it('refuses an already-used authorisation', () => {
    const authorisation = makeAuthorisation();
    const reason = policy.evaluate(
      authorisation,
      action,
      subject,
      new Date(start.getTime() + 1000),
      true,
    );
    expect(reason?.value).toBe(REFUSAL_ALREADY_USED);
  });

  it('checks SCOPE before EXPIRY before USE', () => {
    // The order is load-bearing: a mismatched authorisation is refused for
    // being the WRONG one, not for being old.
    const authorisation = makeAuthorisation();

    const wrongActionAndExpired = policy.evaluate(
      authorisation,
      otherAction,
      subject,
      new Date(start.getTime() + LIFETIME),
      true,
    );
    expect(wrongActionAndExpired?.value).toBe(REFUSAL_OUT_OF_SCOPE);

    const expiredAndSpent = policy.evaluate(
      authorisation,
      action,
      subject,
      new Date(start.getTime() + LIFETIME),
      true,
    );
    expect(expiredAndSpent?.value).toBe(REFUSAL_EXPIRED);
  });
});
