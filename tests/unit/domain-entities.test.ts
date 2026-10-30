/**
 * Unit tests for the domain entities and events.
 *
 * These cover the parts of the domain that the API tests exercise only
 * indirectly: the entity behaviour itself, and the shape of the events
 * this unit PUBLISHES.
 *
 * The event tests matter for a specific reason. `SignInRefused` is the
 * event-stream counterpart of the response-body discipline: if it carried
 * a reason distinguishing "unknown identity" from "wrong password", the
 * event stream would be the identity oracle that the HTTP response is
 * careful not to be. That is an invariant worth a test of its own.
 */
import { describe, it, expect } from 'vitest';
import { Operator } from '../../src/008-operator-identity/domain/entities/operator.js';
import { IdentitySession } from '../../src/008-operator-identity/domain/entities/identity-session.js';
import {
  SESSION_END_CAUSE_EXPIRED,
  SESSION_END_CAUSE_REPLACED,
  SESSION_END_CAUSE_SIGNED_OUT,
} from '../../src/008-operator-identity/domain/entities/identity-session.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { SessionToken } from '../../src/008-operator-identity/domain/value-objects/session-token.js';
import { AuthenticationMethod } from '../../src/008-operator-identity/domain/value-objects/authentication-method.js';
import {
  OperatorSignedIn,
  OperatorSignedOut,
  SessionExpired,
  CredentialRotated,
  OperatorDeactivated,
  SignInRefused,
} from '../../src/008-operator-identity/domain/events/identity-events.js';

const CREATED_AT = new Date('2026-10-30T08:00:00.000Z');

function makeOperator(overrides?: {
  displayName?: string;
  role?: OperatorRole;
  active?: boolean;
}): Operator {
  return new Operator(
    OperatorId.create('OP-001'),
    overrides?.displayName ?? 'R. Karim',
    overrides?.role ?? OperatorRole.operator(),
    overrides?.active ?? true,
    CREATED_AT,
  );
}

function makeSession(overrides?: {
  role?: OperatorRole;
  expiresAt?: Date;
  endedAt?: Date | null;
  endedCause?: string | null;
}): IdentitySession {
  return new IdentitySession(
    'session-1',
    OperatorId.create('OP-001'),
    overrides?.role ?? OperatorRole.operator(),
    AuthenticationMethod.local(),
    new SessionToken('token-value'),
    CREATED_AT,
    overrides?.expiresAt ?? new Date('2026-10-30T16:00:00.000Z'),
    overrides?.endedAt ?? null,
    (overrides?.endedCause ?? null) as never,
  );
}

describe('Operator', () => {
  it('reports its active state', () => {
    expect(makeOperator().isActive()).toBe(true);
    expect(makeOperator({ active: false }).isActive()).toBe(false);
  });

  it('reports whether it is a supervisor', () => {
    expect(makeOperator().isSupervisor()).toBe(false);
    expect(
      makeOperator({ role: OperatorRole.supervisor() }).isSupervisor(),
    ).toBe(true);
  });

  it('deactivate returns a NEW instance and leaves the original active', () => {
    // The entity is immutable. A consumer holding the original reference
    // must not see it change underneath them.
    const original = makeOperator();
    const deactivated = original.deactivate();

    expect(deactivated.isActive()).toBe(false);
    expect(original.isActive()).toBe(true);
    expect(deactivated).not.toBe(original);
  });

  it('deactivate preserves identity, role and creation time', () => {
    const original = makeOperator({ displayName: 'R. Karim' });
    const deactivated = original.deactivate();

    expect(deactivated.id.value).toBe('OP-001');
    expect(deactivated.displayName).toBe('R. Karim');
    expect(deactivated.role.value).toBe('OPERATOR');
    expect(deactivated.createdAt).toEqual(CREATED_AT);
  });

  it('rename returns a new instance with the new display name', () => {
    const original = makeOperator();
    const renamed = original.rename('R. Karim-Lutfi');

    expect(renamed.displayName).toBe('R. Karim-Lutfi');
    expect(original.displayName).toBe('R. Karim');
  });
});

describe('IdentitySession', () => {
  it('refuses a session that expires at or before authentication', () => {
    expect(
      () =>
        new IdentitySession(
          'session-1',
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          AuthenticationMethod.local(),
          new SessionToken('t'),
          CREATED_AT,
          CREATED_AT,
        ),
    ).toThrow(/expire after/);
  });

  it('refuses a session that expires BEFORE authentication', () => {
    expect(
      () =>
        new IdentitySession(
          'session-1',
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          AuthenticationMethod.local(),
          new SessionToken('t'),
          CREATED_AT,
          new Date(CREATED_AT.getTime() - 1000),
        ),
    ).toThrow(/expire after/);
  });

  it('is not ended when it is fresh', () => {
    expect(makeSession().isEnded()).toBe(false);
  });

  it('end returns a NEW instance carrying the end time and cause', () => {
    const session = makeSession();
    const endedAt = new Date('2026-10-30T09:00:00.000Z');
    const ended = session.end(endedAt, SESSION_END_CAUSE_SIGNED_OUT);

    expect(ended.isEnded()).toBe(true);
    expect(ended.endedAt).toEqual(endedAt);
    expect(ended.endedCause).toBe('SIGNED_OUT');
    expect(session.isEnded()).toBe(false);
  });

  it('end preserves every other field', () => {
    const session = makeSession({ role: OperatorRole.supervisor() });
    const ended = session.end(new Date('2026-10-30T09:00:00.000Z'), SESSION_END_CAUSE_EXPIRED);

    expect(ended.id).toBe('session-1');
    expect(ended.operatorId.value).toBe('OP-001');
    expect(ended.role.value).toBe('SUPERVISOR');
    expect(ended.token.raw).toBe('token-value');
    expect(ended.authenticatedAt).toEqual(CREATED_AT);
  });

  it('records each end cause distinctly', () => {
    const at = new Date('2026-10-30T09:00:00.000Z');
    expect(makeSession().end(at, SESSION_END_CAUSE_SIGNED_OUT).endedCause).toBe(
      'SIGNED_OUT',
    );
    expect(makeSession().end(at, SESSION_END_CAUSE_REPLACED).endedCause).toBe(
      'REPLACED',
    );
    expect(makeSession().end(at, SESSION_END_CAUSE_EXPIRED).endedCause).toBe(
      'EXPIRED',
    );
  });

  it('reports the supervisor role it was created with', () => {
    expect(makeSession().isSupervisor()).toBe(false);
    expect(makeSession({ role: OperatorRole.supervisor() }).isSupervisor()).toBe(
      true,
    );
  });
});

describe('the published events', () => {
  it('OperatorSignedIn carries the session, operator, role and method', () => {
    const event = new OperatorSignedIn(
      'session-1',
      OperatorId.create('OP-001'),
      OperatorRole.supervisor(),
      'LOCAL',
      CREATED_AT,
      new Date('2026-10-30T16:00:00.000Z'),
      CREATED_AT,
    );

    expect(event.type).toBe('OperatorSignedIn');
    expect(event.sessionId).toBe('session-1');
    expect(event.operatorId.value).toBe('OP-001');
    expect(event.role.value).toBe('SUPERVISOR');
    expect(event.method).toBe('LOCAL');
    expect(event.occurredAt).toEqual(CREATED_AT);
  });

  it('OperatorSignedOut carries the session and the cause', () => {
    const event = new OperatorSignedOut(
      'session-1',
      OperatorId.create('OP-001'),
      CREATED_AT,
      'SIGNED_OUT',
      CREATED_AT,
    );

    expect(event.type).toBe('OperatorSignedOut');
    expect(event.sessionId).toBe('session-1');
    expect(event.cause).toBe('SIGNED_OUT');
  });

  it('SessionExpired carries the expiry instant', () => {
    const expiredAt = new Date('2026-10-30T16:00:00.000Z');
    const event = new SessionExpired(
      'session-1',
      OperatorId.create('OP-001'),
      expiredAt,
      expiredAt,
    );

    expect(event.type).toBe('SessionExpired');
    expect(event.expiredAt).toEqual(expiredAt);
  });

  it('CredentialRotated carries the operator and role', () => {
    const event = new CredentialRotated(
      OperatorId.create('OP-001'),
      OperatorRole.operator(),
      CREATED_AT,
      CREATED_AT,
    );

    expect(event.type).toBe('CredentialRotated');
    expect(event.operatorId.value).toBe('OP-001');
    expect(event.role.value).toBe('OPERATOR');
  });

  it('OperatorDeactivated carries the operator and the instant', () => {
    const event = new OperatorDeactivated(
      OperatorId.create('OP-001'),
      CREATED_AT,
      CREATED_AT,
    );

    expect(event.type).toBe('OperatorDeactivated');
    expect(event.operatorId.value).toBe('OP-001');
  });

  it('SignInRefused carries the PRESENTED id, not a resolved one', () => {
    const event = new SignInRefused('GHOST-999', CREATED_AT);

    expect(event.type).toBe('SignInRefused');
    expect(event.presentedOperatorId).toBe('GHOST-999');
  });

  it('SignInRefused has EXACTLY ONE reason — the event stream is not an oracle', () => {
    // This is the event-stream half of the identity-oracle defence. If a
    // reason were added that distinguished an unknown identity from a
    // wrong secret, anyone with read access to the event stream could
    // enumerate operators even though the HTTP response cannot.
    const event = new SignInRefused('OP-001', CREATED_AT);

    expect(event.reason).toBe('INVALID_CREDENTIAL');
    expect(
      Object.getOwnPropertyNames(event).filter(
        (name) => name !== 'presentedOperatorId' && name !== 'occurredAt',
      ),
    ).toEqual(['type', 'reason']);
  });

  it('NO event carries a secret, a token or a stored hash', () => {
    // Every published event, serialised, must be free of credential
    // material. A token or hash in an event would land in an audit trail
    // that unit 006 owns and that may be shipped elsewhere.
    const events = [
      new OperatorSignedIn(
        'session-1',
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        'LOCAL',
        CREATED_AT,
        new Date('2026-10-30T16:00:00.000Z'),
        CREATED_AT,
      ),
      new OperatorSignedOut(
        'session-1',
        OperatorId.create('OP-001'),
        CREATED_AT,
        'SIGNED_OUT',
        CREATED_AT,
      ),
      new SessionExpired(
        'session-1',
        OperatorId.create('OP-001'),
        CREATED_AT,
        CREATED_AT,
      ),
      new CredentialRotated(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        CREATED_AT,
        CREATED_AT,
      ),
      new OperatorDeactivated(
        OperatorId.create('OP-001'),
        CREATED_AT,
        CREATED_AT,
      ),
      new SignInRefused('OP-001', CREATED_AT),
    ];

    for (const event of events) {
      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain('token');
      expect(serialised).not.toContain('secret');
      expect(serialised).not.toContain('argon2');
      expect(serialised).not.toContain('$argon2id$');
    }
  });
});
