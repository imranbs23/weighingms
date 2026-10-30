/**
 * Unit tests for the value objects — the type-level invariants.
 *
 * These are the tests that prove the invariants are STRUCTURAL rather than
 * conventional. If someone later adds a `decode()` to SessionToken, or a
 * public constructor to SecretHash, these tests are the tripwire.
 */
import { describe, it, expect } from 'vitest';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import {
  OperatorRole,
  OPERATOR_ROLE_OPERATOR,
  OPERATOR_ROLE_SUPERVISOR,
} from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import {
  SecretHash,
  SECRET_HASH_ALGORITHM_ARGON2ID,
} from '../../src/008-operator-identity/domain/value-objects/secret-hash.js';
import { SessionToken } from '../../src/008-operator-identity/domain/value-objects/session-token.js';
import {
  AuthenticationMethod,
  AUTHENTICATION_METHOD_LOCAL,
  AUTHENTICATION_METHOD_DIRECTORY,
} from '../../src/008-operator-identity/domain/value-objects/authentication-method.js';
import {
  AuthenticationOutcome,
  AuthenticationFailure,
  AUTHENTICATION_FAILURE_REASON,
} from '../../src/008-operator-identity/domain/value-objects/authentication-outcome.js';

describe('OperatorId', () => {
  it('trims surrounding whitespace', () => {
    expect(OperatorId.create('  OP-001  ').value).toBe('OP-001');
  });

  it('rejects an empty id', () => {
    expect(() => OperatorId.create('   ')).toThrow();
  });

  it('compares EXACTLY — case differences are different identities', () => {
    // Case folding here would let one badge sign in as another.
    expect(OperatorId.create('OP-001').equals(OperatorId.create('op-001'))).toBe(
      false,
    );
  });

  it('rejects an id over 64 characters', () => {
    expect(() => OperatorId.create('x'.repeat(65))).toThrow();
  });

  it('accepts an id of exactly 64 characters', () => {
    expect(OperatorId.create('x'.repeat(64)).value).toHaveLength(64);
  });

  it('compares equal ids as equal', () => {
    expect(OperatorId.create('OP-001').equals(OperatorId.create('OP-001'))).toBe(
      true,
    );
  });

  it('stringifies to its value', () => {
    expect(OperatorId.create('OP-001').toString()).toBe('OP-001');
  });
});

describe('OperatorRole', () => {
  it('exposes exactly two roles', () => {
    expect(OperatorRole.operator().value).toBe(OPERATOR_ROLE_OPERATOR);
    expect(OperatorRole.supervisor().value).toBe(OPERATOR_ROLE_SUPERVISOR);
  });

  it('isSupervisor distinguishes the two', () => {
    expect(OperatorRole.operator().isSupervisor()).toBe(false);
    expect(OperatorRole.supervisor().isSupervisor()).toBe(true);
  });

  it('THROWS on an unknown stored role rather than defaulting', () => {
    // Defaulting would silently turn a corrupted role into the LESS
    // privileged role and would hide the corruption.
    expect(() => OperatorRole.fromStored('ADMIN')).toThrow(/Unknown operator role/);
  });

  it('round-trips through fromStored', () => {
    expect(OperatorRole.fromStored('SUPERVISOR').isSupervisor()).toBe(true);
    expect(OperatorRole.fromStored('OPERATOR').isSupervisor()).toBe(false);
  });

  it('compares roles by value', () => {
    expect(OperatorRole.operator().equals(OperatorRole.operator())).toBe(true);
    expect(OperatorRole.operator().equals(OperatorRole.supervisor())).toBe(false);
  });

  it('stringifies to its value', () => {
    expect(OperatorRole.supervisor().toString()).toBe('SUPERVISOR');
  });
});

describe('AuthenticationMethod', () => {
  it('exposes LOCAL and DIRECTORY', () => {
    expect(AuthenticationMethod.local().value).toBe(AUTHENTICATION_METHOD_LOCAL);
    expect(AuthenticationMethod.directory().value).toBe(
      AUTHENTICATION_METHOD_DIRECTORY,
    );
  });

  it('reports whether it is local', () => {
    expect(AuthenticationMethod.local().isLocal()).toBe(true);
    expect(AuthenticationMethod.directory().isLocal()).toBe(false);
  });

  it('round-trips through fromStored', () => {
    expect(AuthenticationMethod.fromStored('LOCAL').isLocal()).toBe(true);
    expect(AuthenticationMethod.fromStored('DIRECTORY').isLocal()).toBe(false);
  });

  it('THROWS on an unknown stored method rather than defaulting', () => {
    // A corrupted method must not silently become LOCAL — that would
    // misreport where the identity came from. The DIRECTORY method exists
    // precisely so that the provenance is recorded truthfully.
    expect(() => AuthenticationMethod.fromStored('MAGIC')).toThrow(
      /Unknown authentication method/,
    );
  });

  it('is case sensitive — a stored method must match exactly', () => {
    expect(() => AuthenticationMethod.fromStored('local')).toThrow();
  });

  it('stringifies to its value', () => {
    expect(AuthenticationMethod.local().toString()).toBe('LOCAL');
  });
});

describe('SecretHash', () => {
  const encoded =
    '$argon2id$m=19456,t=2,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';

  it('parses its own algorithm and parameters back out', () => {
    const hash = SecretHash.parse(encoded);
    expect(hash.algorithm).toBe(SECRET_HASH_ALGORITHM_ARGON2ID);
    expect(hash.parameters.memory).toBe(19456);
    expect(hash.parameters.passes).toBe(2);
    expect(hash.parameters.parallelism).toBe(1);
  });

  it('rejects a malformed encoding', () => {
    expect(() => SecretHash.parse('not-a-hash')).toThrow(/Malformed/);
  });

  it('rejects an unsupported algorithm', () => {
    const bad = encoded.replace('$argon2id$', '$bcrypt$');
    expect(() => SecretHash.parse(bad)).toThrow(/Unsupported/);
  });

  it('carries the parameters so the work factor can be raised later', () => {
    // This is what makes ADR-001's "raise the cost without invalidating
    // existing credentials" possible: each hash records the parameters
    // it was made with.
    const hash = SecretHash.parse(encoded);
    expect(hash.parameters.memory).toBeGreaterThan(0);
  });

  it('rejects an encoded hash with the wrong number of parts', () => {
    expect(() => SecretHash.parse('$argon2id$m=19456,t=2,p=1$salt')).toThrow(
      /Malformed/,
    );
  });

  it('rejects a missing parameter', () => {
    expect(() =>
      SecretHash.parse('$argon2id$m=19456,t=2$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamts'),
    ).toThrow(/Missing p in encoded hash parameters/);
  });

  it('rejects a non-numeric parameter', () => {
    expect(() =>
      SecretHash.parse(
        '$argon2id$m=lots,t=2,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamts',
      ),
    ).toThrow(/Invalid m in encoded hash parameters/);
  });

  it('reconstructs from an encoded value with explicit parameters', () => {
    const hash = SecretHash.fromEncoded(encoded, {
      memory: 19456,
      passes: 2,
      parallelism: 1,
      tagLength: 32,
    });
    expect(hash.encoded).toBe(encoded);
    expect(hash.algorithm).toBe('argon2id');
  });

  it('refuses an EMPTY encoded value', () => {
    expect(() =>
      SecretHash.fromEncoded('', {
        memory: 19456,
        passes: 2,
        parallelism: 1,
        tagLength: 32,
      }),
    ).toThrow(/must not be empty/);
  });

  it('compares by encoded value', () => {
    expect(SecretHash.parse(encoded).equals(SecretHash.parse(encoded))).toBe(true);
    // A well-formed hash with a different work factor is still a
    // DIFFERENT hash — the encoded value is the identity.
    const stronger =
      '$argon2id$m=65536,t=3,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';
    expect(SecretHash.parse(encoded).equals(SecretHash.parse(stronger))).toBe(
      false,
    );
  });

  it('stringifies to its encoded value', () => {
    expect(SecretHash.parse(encoded).toString()).toBe(encoded);
  });
});

describe('SessionToken', () => {
  it('rejects an empty token', () => {
    expect(() => new SessionToken('')).toThrow();
  });

  it('compares by value', () => {
    expect(new SessionToken('abc').equals(new SessionToken('abc'))).toBe(true);
    expect(new SessionToken('abc').equals(new SessionToken('xyz'))).toBe(false);
  });

  it('exposes its raw value for hashing and transport', () => {
    expect(new SessionToken('abc').raw).toBe('abc');
  });

  it('stringifies to its raw value', () => {
    expect(new SessionToken('abc').toString()).toBe('abc');
  });

  it('has NO decode operation — the value is opaque', () => {
    // INVARIANT I-2. If a decode/claims/payload accessor is ever added to
    // the type, this test fails and the change has to be argued for.
    const token = new SessionToken('eyJhbGciOiJIUzI1NiJ9.eyJvcCI6Ik9QLTAwMSJ9.sig');
    const surface = Object.getOwnPropertyNames(
      Object.getPrototypeOf(token),
    ).concat(Object.getOwnPropertyNames(token));
    for (const forbidden of ['decode', 'payload', 'claims', 'parse', 'verify']) {
      expect(surface).not.toContain(forbidden);
    }
  });
});

describe('AuthenticationOutcome', () => {
  it('reports success and carries the session', () => {
    const outcome = AuthenticationOutcome.success({} as never);
    expect(outcome.isSuccess()).toBe(true);
    expect(outcome.getSession()).not.toBeNull();
    expect(outcome.getFailure()).toBeNull();
  });

  it('reports failure with exactly one failure shape', () => {
    const outcome = AuthenticationOutcome.failure();
    expect(outcome.isSuccess()).toBe(false);
    expect(outcome.getSession()).toBeNull();
    expect(outcome.getFailure()).not.toBeNull();
  });

  it('REFUSES to construct a failure carrying a distinguishing reason', () => {
    // The identity-oracle defence, enforced at the type level.
    expect(() => AuthenticationFailure.create('UNKNOWN_OPERATOR')).toThrow(
      /identity oracle/,
    );
    expect(() => AuthenticationFailure.create('WRONG_SECRET')).toThrow(
      /identity oracle/,
    );
  });

  it('accepts the single permitted reason', () => {
    const failure = AuthenticationFailure.create(AUTHENTICATION_FAILURE_REASON);
    expect(failure).toBeInstanceOf(AuthenticationFailure);
  });

  it('the failure shape carries NO field that could distinguish causes', () => {
    const failure = AuthenticationFailure.create();
    const fields = Object.getOwnPropertyNames(failure);
    expect(fields).toHaveLength(0);
  });
});
