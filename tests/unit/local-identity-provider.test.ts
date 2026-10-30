/**
 * Unit tests for LocalIdentityProvider — the constant-work provider.
 *
 * The provider is the adapter that would be REPLACED if Q-08 resolves to
 * FCI supplying an operator directory. These tests pin the behaviour that
 * must NOT change when that replacement happens: the constant-work
 * guarantee, and the fact that the role comes from the resolved operator
 * rather than from the request.
 *
 * The hasher here is a recording double, not the real Argon2. What is
 * under test is the provider's CONTROL FLOW — how many verifications it
 * performs, and against what. The real Argon2 cost is measured separately
 * by the statistical timing test in the security suite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalIdentityProvider } from '../../src/008-operator-identity/infrastructure/security/local-identity-provider.js';
import { Operator } from '../../src/008-operator-identity/domain/entities/operator.js';
import { Credential } from '../../src/008-operator-identity/domain/entities/credential.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { SecretHash } from '../../src/008-operator-identity/domain/value-objects/secret-hash.js';
import type { SecretHasher } from '../../src/008-operator-identity/domain/ports/secret-hasher.js';
import type {
  CredentialRepository,
  OperatorRepository,
} from '../../src/008-operator-identity/domain/ports/repositories.js';

const NOW = new Date('2026-10-30T08:00:00.000Z');
const HASH_A =
  '$argon2id$m=19456,t=2,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';
const HASH_B =
  '$argon2id$m=19456,t=2,p=1$ZGVmZ2hpamtsYWJj$ZGVmZ2hpamtsYWJjbW9wcXJzdHVuZ3h5ekFCMzQ1Njc4';
/**
 * The hash the provider makes for its DUMMY secret.
 *
 * It is deliberately a DIFFERENT encoded string from HASH_A and HASH_B,
 * so the test can tell a dummy-path verification from a real one. If the
 * dummy hash were indistinguishable from a real hash, "the unknown path
 * verified against the dummy" would be untestable — and an untestable
 * guarantee is not a guarantee.
 */
const DUMMY_HASH =
  '$argon2id$m=19456,t=2,p=1$ZHVtbXlkdW1teQ$ZHVtbXlkdW1teWhhc2g1bW15ZG91bW15MTIzNDU2';

/**
 * A hasher that records every verification and answers from a fixed map.
 *
 * `dummyHashCalls` counts verifications against the DUMMY hash — the ones
 * that make the unknown-operator path cost the same as the known one.
 */
class RecordingHasher implements SecretHasher {
  readonly verifications: { hash: SecretHash; secret: string }[] = [];
  readonly hashes: string[] = [];
  readonly matches = new Map<string, string>();

  constructor() {
    // The dummy secret is the one the provider uses for its dummy hash.
    this.matches.set('dummy-secret-for-constant-work', DUMMY_HASH);
  }

  hash(secret: string): SecretHash {
    this.hashes.push(secret);
    const encoded = this.matches.get(secret) ?? DUMMY_HASH;
    return SecretHash.parse(encoded);
  }

  verify(hash: SecretHash, secret: string): boolean {
    this.verifications.push({ hash, secret });
    // A verification succeeds when the secret is the one this hash was
    // made from.
    for (const [plaintext, encoded] of this.matches) {
      if (encoded === hash.encoded) return plaintext === secret;
    }
    return false;
  }

  /** How many verifications were performed against the DUMMY hash. */
  get dummyHashCalls(): number {
    return this.verifications.filter((v) => v.hash.encoded === DUMMY_HASH).length;
  }
}

class FakeOperatorRepository implements OperatorRepository {
  readonly operators = new Map<string, Operator>();

  async findById(id: OperatorId): Promise<Operator | null> {
    return this.operators.get(id.value) ?? null;
  }
  async save(operator: Operator): Promise<void> {
    this.operators.set(operator.id.value, operator);
  }
  async findAll(): Promise<Operator[]> {
    return [...this.operators.values()];
  }
}

class FakeCredentialRepository implements CredentialRepository {
  readonly credentials: Credential[] = [];

  async findByOperatorAndRole(
    operatorId: OperatorId,
    role: OperatorRole,
  ): Promise<Credential | null> {
    return (
      this.credentials.find(
        (c) => c.operatorId.value === operatorId.value && c.role.value === role.value,
      ) ?? null
    );
  }
  async findByOperator(operatorId: OperatorId): Promise<Credential[]> {
    return this.credentials.filter((c) => c.operatorId.value === operatorId.value);
  }
  async save(credential: Credential): Promise<void> {
    this.credentials.push(credential);
  }
}

describe('LocalIdentityProvider', () => {
  let hasher: RecordingHasher;
  let operators: FakeOperatorRepository;
  let credentials: FakeCredentialRepository;
  let provider: LocalIdentityProvider;

  beforeEach(() => {
    hasher = new RecordingHasher();
    operators = new FakeOperatorRepository();
    credentials = new FakeCredentialRepository();
    provider = new LocalIdentityProvider(operators, credentials, hasher);
  });

  it('reports itself as LOCAL and always available', async () => {
    expect(provider.kind).toBe('LOCAL');
    expect(await provider.available()).toBe(true);
  });

  it('describes itself', () => {
    expect(provider.describe()).toMatch(/Local operator directory/);
  });

  it('computes the dummy hash ONCE, at construction', () => {
    // The dummy hash is reused on every unknown-operator sign-in. If it
    // were recomputed per request, the unknown path would be SLOWER than
    // the known path — the opposite of what the guarantee needs.
    expect(hasher.hashes).toEqual(['dummy-secret-for-constant-work']);
  });

  it('finds an operator by id', async () => {
    await operators.save(
      new Operator(
        OperatorId.create('OP-001'),
        'R. Karim',
        OperatorRole.operator(),
        true,
        NOW,
      ),
    );

    const found = await provider.findOperator(OperatorId.create('OP-001'));
    expect(found).not.toBeNull();
    expect(found!.displayName).toBe('R. Karim');
  });

  it('returns null for an unknown operator', async () => {
    expect(
      await provider.findOperator(OperatorId.create('GHOST-999')),
    ).toBeNull();
  });

  describe('verifyCredential', () => {
    beforeEach(() => {
      // The real credential hashes are registered so the double can
      // answer "does this secret match this hash?".
      hasher.matches.set('4821', HASH_A);
      hasher.matches.set('9164', HASH_B);
    });

    it('fails for an unknown operator, AFTER performing a verification', async () => {
      const outcome = await provider.verifyCredential(
        OperatorId.create('GHOST-999'),
        'anything',
      );

      expect(outcome.isVerified()).toBe(false);
      // The work happened — this is the timing half of the guarantee.
      expect(hasher.verifications).toHaveLength(1);
      expect(hasher.dummyHashCalls).toBe(1);
    });

    it('fails for an operator with NO credential, AFTER performing a verification', async () => {
      // A half-provisioned operator — the row exists, the credential does
      // not. This path must ALSO do the work, or it becomes a cheaper
      // oracle than either of the two common paths.
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );

      const outcome = await provider.verifyCredential(
        OperatorId.create('OP-001'),
        '4821',
      );

      expect(outcome.isVerified()).toBe(false);
      expect(hasher.verifications).toHaveLength(1);
      expect(hasher.dummyHashCalls).toBe(1);
    });

    it('fails for a wrong secret, having performed a verification', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(HASH_A),
          NOW,
        ),
      );

      const outcome = await provider.verifyCredential(
        OperatorId.create('OP-001'),
        'wrong',
      );

      expect(outcome.isVerified()).toBe(false);
      expect(hasher.verifications).toHaveLength(1);
      // A real verification, NOT the dummy — the cost is the same either
      // way, which is the whole point.
      expect(hasher.dummyHashCalls).toBe(0);
    });

    it('succeeds for the correct secret', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(HASH_A),
          NOW,
        ),
      );

      const outcome = await provider.verifyCredential(
        OperatorId.create('OP-001'),
        '4821',
      );

      expect(outcome.isVerified()).toBe(true);
      expect(outcome.getOperator()).not.toBeNull();
      expect(outcome.getOperator()!.id.value).toBe('OP-001');
    });

    it('takes the role from the OPERATOR, never from the request', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('SUP-001'),
          'S. Ahmed',
          OperatorRole.supervisor(),
          true,
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('SUP-001'),
          OperatorRole.supervisor(),
          SecretHash.parse(HASH_B),
          NOW,
        ),
      );

      const outcome = await provider.verifyCredential(
        OperatorId.create('SUP-001'),
        '9164',
      );

      expect(outcome.isVerified()).toBe(true);
      expect(outcome.getOperator()!.role.value).toBe('SUPERVISOR');
      expect(outcome.getOperator()!.isSupervisor()).toBe(true);
    });

    it('verifies EVERY candidate credential, not just the first', async () => {
      // The number of verifications must not depend on WHICH credential
      // matched. If the loop stopped at the first match, a matching
      // SUPERVISOR credential would be cheaper than a matching OPERATOR
      // one — a timing signal about which roles exist.
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(HASH_A),
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.supervisor(),
          SecretHash.parse(HASH_B),
          NOW,
        ),
      );

      const outcome = await provider.verifyCredential(
        OperatorId.create('OP-001'),
        '4821',
      );

      expect(outcome.isVerified()).toBe(true);
      // BOTH credentials were verified, even though the first matched.
      expect(hasher.verifications).toHaveLength(2);
    });

    it('the unknown-operator path and the wrong-secret path do the SAME NUMBER of verifications', async () => {
      await operators.save(
        new Operator(
          OperatorId.create('OP-001'),
          'R. Karim',
          OperatorRole.operator(),
          true,
          NOW,
        ),
      );
      credentials.credentials.push(
        Credential.fromHash(
          OperatorId.create('OP-001'),
          OperatorRole.operator(),
          SecretHash.parse(HASH_A),
          NOW,
        ),
      );

      hasher.verifications.length = 0;
      await provider.verifyCredential(OperatorId.create('GHOST-999'), 'anything');
      const unknownCount = hasher.verifications.length;

      hasher.verifications.length = 0;
      await provider.verifyCredential(OperatorId.create('OP-001'), 'wrong');
      const wrongSecretCount = hasher.verifications.length;

      expect(unknownCount).toBe(wrongSecretCount);
      expect(unknownCount).toBe(1);
    });
  });
});
