/**
 * Unit tests for SessionPolicy — the pure session lifetime rules.
 *
 * The expiry boundary is the critical case. The story says "the session
 * expires exactly at `expiresAt` ... expiry is evaluated at the boundary,
 * not after it". A session that were live AT the instant of expiry would
 * be live for one instant too many.
 */
import { describe, it, expect } from 'vitest';
import { SessionPolicy } from '../../src/008-operator-identity/domain/services/session-policy.js';
import { IdentitySession } from '../../src/008-operator-identity/domain/entities/identity-session.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { SessionToken } from '../../src/008-operator-identity/domain/value-objects/session-token.js';
import { AuthenticationMethod } from '../../src/008-operator-identity/domain/value-objects/authentication-method.js';

const AUTHENTICATED_AT = new Date('2026-10-30T08:00:00.000Z');
const EXPIRES_AT = new Date('2026-10-30T16:00:00.000Z');

function makeSession(overrides?: {
  expiresAt?: Date;
  endedAt?: Date | null;
}): IdentitySession {
  return new IdentitySession(
    'session-1',
    OperatorId.create('OP-001'),
    OperatorRole.operator(),
    AuthenticationMethod.local(),
    new SessionToken('token-value'),
    AUTHENTICATED_AT,
    overrides?.expiresAt ?? EXPIRES_AT,
    overrides?.endedAt ?? null,
  );
}

describe('SessionPolicy', () => {
  describe('the expiry boundary', () => {
    it('is live one millisecond before expiry', () => {
      const policy = new SessionPolicy(() => new Date(EXPIRES_AT.getTime() - 1));
      expect(policy.isLive(makeSession())).toBe(true);
      expect(policy.isExpired(makeSession())).toBe(false);
    });

    it('is EXPIRED exactly at the expiry instant', () => {
      const policy = new SessionPolicy(() => new Date(EXPIRES_AT.getTime()));
      expect(policy.isLive(makeSession())).toBe(false);
      expect(policy.isExpired(makeSession())).toBe(true);
    });

    it('is expired one millisecond after expiry', () => {
      const policy = new SessionPolicy(() => new Date(EXPIRES_AT.getTime() + 1));
      expect(policy.isLive(makeSession())).toBe(false);
      expect(policy.isExpired(makeSession())).toBe(true);
    });
  });

  describe('ended sessions', () => {
    it('authorises nothing once ended, even well before expiry', () => {
      const ended = makeSession({
        endedAt: new Date('2026-10-30T09:00:00.000Z'),
      });
      const policy = new SessionPolicy(() => new Date('2026-10-30T10:00:00.000Z'));
      expect(policy.isLive(ended)).toBe(false);
      expect(policy.isEnded(ended)).toBe(true);
    });

    it('an ended session is expired-looking only via isEnded, not isExpired', () => {
      const ended = makeSession({
        endedAt: new Date('2026-10-30T09:00:00.000Z'),
      });
      const policy = new SessionPolicy(() => new Date('2026-10-30T10:00:00.000Z'));
      // The session has not EXPIRED — it was ended early. The two are
      // different facts and the policy keeps them apart.
      expect(policy.isExpired(ended)).toBe(false);
    });
  });

  describe('remainingLifetime', () => {
    it('reports the remaining milliseconds', () => {
      const policy = new SessionPolicy(() => new Date('2026-10-30T12:00:00.000Z'));
      expect(policy.remainingLifetime(makeSession())).toBe(4 * 60 * 60 * 1000);
    });

    it('reports zero once expired, never a negative number', () => {
      const policy = new SessionPolicy(() => new Date(EXPIRES_AT.getTime() + 5000));
      expect(policy.remainingLifetime(makeSession())).toBe(0);
    });
  });
});
