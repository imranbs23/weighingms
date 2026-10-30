/**
 * Unit tests for CredentialService — the only place a plaintext secret
 * exists.
 *
 * The service is tested against a recording fake rather than the real
 * Argon2 hasher, because what is under test here is the service's OWN
 * behaviour: that it hashes before it stores, that it delegates
 * verification to the hasher, and that the plaintext never reaches the
 * repository. The real Argon2 implementation is covered separately by the
 * security suite; testing it again here would only slow the suite down.
 *
 * The Argon2id behaviour itself is NOT mocked away — it is tested for real
 * in `tests/security/identity-security.test.ts`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialService } from '../../src/008-operator-identity/domain/services/credential-service.js';
import { Credential } from '../../src/008-operator-identity/domain/entities/credential.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { SecretHash } from '../../src/008-operator-identity/domain/value-objects/secret-hash.js';
import type { CredentialRepository } from '../../src/008-operator-identity/domain/ports/repositories.js';
import type { SecretHasher } from '../../src/008-operator-identity/domain/ports/secret-hasher.js';

const NOW = new Date('2026-10-30T08:00:00.000Z');
const ENCODED = '$argon2id$m=19456,t=2,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';

/** A hasher that records what it was asked to do. */
class RecordingHasher implements SecretHasher {
  readonly hashed: string[] = [];
  readonly verified: { hash: SecretHash; secret: string }[] = [];

  hash(secret: string): SecretHash {
    this.hashed.push(secret);
    return SecretHash.parse(ENCODED);
  }

  verify(hash: SecretHash, secret: string): boolean {
    this.verified.push({ hash, secret });
    return secret === 'correct';
  }
}

/** A repository that records what it was asked to store. */
class RecordingCredentialRepository implements CredentialRepository {
  readonly saved: Credential[] = [];

  async findByOperatorAndRole(): Promise<Credential | null> {
    return null;
  }
  async findByOperator(): Promise<Credential[]> {
    return [];
  }
  async save(credential: Credential): Promise<void> {
    this.saved.push(credential);
  }
}

describe('CredentialService', () => {
  let hasher: RecordingHasher;
  let repository: RecordingCredentialRepository;
  let service: CredentialService;

  beforeEach(() => {
    hasher = new RecordingHasher();
    repository = new RecordingCredentialRepository();
    service = new CredentialService(hasher, repository, () => NOW);
  });

  describe('create', () => {
    it('hashes the secret before storing it', async () => {
      await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );

      expect(hasher.hashed).toEqual(['4821']);
      expect(repository.saved).toHaveLength(1);
    });

    it('stores a HASH, never the plaintext', async () => {
      const credential = await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );

      // The stored credential carries a SecretHash. The plaintext is not
      // on the credential, on the hash, or anywhere in its serialised
      // form.
      expect(credential.secretHash).toBeInstanceOf(SecretHash);
      expect(JSON.stringify(credential)).not.toContain('4821');
      expect(credential.secretHash.encoded).not.toContain('4821');
    });

    it('records the role as the authority of record', async () => {
      const credential = await service.create(
        OperatorId.create('SUP-001'),
        OperatorRole.supervisor(),
        '9164',
      );

      expect(credential.role.value).toBe('SUPERVISOR');
      expect(credential.role.isSupervisor()).toBe(true);
    });

    it('stamps the rotation time from the injected clock', async () => {
      const credential = await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );

      expect(credential.rotatedAt).toEqual(NOW);
    });

    it('binds the credential to the operator it was created for', async () => {
      const credential = await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );

      expect(credential.operatorId.value).toBe('OP-001');
    });
  });

  describe('rotate', () => {
    it('replaces the stored credential with a new hash', async () => {
      await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );
      await service.rotate(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '7359',
      );

      expect(hasher.hashed).toEqual(['4821', '7359']);
      expect(repository.saved).toHaveLength(2);
    });

    it('stores the NEW secret only as a hash', async () => {
      const rotated = await service.rotate(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '7359',
      );

      expect(rotated.secretHash.encoded).not.toContain('7359');
      expect(JSON.stringify(rotated)).not.toContain('7359');
    });

    it('keeps the rotation time from the injected clock', async () => {
      const rotated = await service.rotate(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '7359',
      );

      expect(rotated.rotatedAt).toEqual(NOW);
    });
  });

  describe('verify', () => {
    it('delegates to the hasher with the stored hash and the presented secret', async () => {
      const credential = await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );
      hasher.verified.length = 0;

      const result = service.verify(credential, '0000');

      expect(result).toBe(false);
      expect(hasher.verified).toHaveLength(1);
      expect(hasher.verified[0]!.secret).toBe('0000');
      expect(hasher.verified[0]!.hash).toBe(credential.secretHash);
    });

    it('returns true for the correct secret', async () => {
      const credential = await service.create(
        OperatorId.create('OP-001'),
        OperatorRole.operator(),
        '4821',
      );

      expect(service.verify(credential, 'correct')).toBe(true);
    });
  });
});
