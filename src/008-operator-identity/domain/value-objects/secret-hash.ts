/**
 * SecretHash — the stored form of a credential.
 *
 * INVARIANT I-1: no plaintext secret exists anywhere in the domain model.
 *
 * This type enforces that BY CONSTRUCTION rather than by review. There is
 * no public constructor that accepts a hash-shaped string: the only way to
 * obtain a SecretHash is `SecretHash.fromEncoded`, and the only thing that
 * can produce that encoded string is a `SecretHasher`. A caller who has
 * "a hash" cannot construct a SecretHash from it without going through the
 * hashing port — so the credential path cannot be bypassed by accident.
 *
 * The encoded form is SELF-DESCRIBING: it carries the algorithm, the
 * parameters and the salt alongside the digest. That means the work factor
 * can be raised later (ADR-001) without invalidating existing credentials,
 * because the old parameters are recorded alongside each old hash.
 */

/** The algorithm identifier recorded in an encoded hash. */
export const SECRET_HASH_ALGORITHM_ARGON2ID = 'argon2id';

export interface SecretHashParameters {
  /** Memory cost in KiB. */
  readonly memory: number;
  /** Number of passes over memory. */
  readonly passes: number;
  /** Degree of parallelism. */
  readonly parallelism: number;
  /** Derived key length in bytes. */
  readonly tagLength: number;
}

export class SecretHash {
  /**
   * @param encoded the self-describing encoded hash
   * @param parameters the parameters used to produce it
   * @param algorithm the algorithm used to produce it
   *
   * Private constructor — see the class docs. `fromEncoded` is the single
   * entry point and is intended to be called by infrastructure code that
   * has just read a persisted row.
   */
  private constructor(
    readonly encoded: string,
    readonly parameters: SecretHashParameters,
    readonly algorithm: string,
  ) {}

  /**
   * Reconstruct a SecretHash from a persisted, encoded value.
   *
   * This is the ONLY way to build one from a string, and it is deliberately
   * the only way that accepts one.
   */
  static fromEncoded(
    encoded: string,
    parameters: SecretHashParameters,
    algorithm: string = SECRET_HASH_ALGORITHM_ARGON2ID,
  ): SecretHash {
    if (encoded.length === 0) {
      throw new Error('SecretHash encoded value must not be empty');
    }
    return new SecretHash(encoded, parameters, algorithm);
  }

  /**
   * Parse a persisted encoded hash that carries its own parameters.
   *
   * The encoding used by the Argon2 hasher is:
   *   $argon2id$m=<memory>,t=<passes>,p=<parallelism>$<saltB64>$<hashB64>
   *
   * Parsing here rather than in the infrastructure layer means the domain
   * owns the meaning of its own value object, and the repository adapter
   * does not need to know the format.
   */
  static parse(encoded: string): SecretHash {
    const parts = encoded.split('$');
    // ['', 'argon2id', 'm=..,t=..,p=..', saltB64, hashB64]
    if (parts.length !== 5 || parts[0] !== '') {
      throw new Error('Malformed encoded secret hash');
    }
    const algorithm = parts[1];
    if (algorithm !== SECRET_HASH_ALGORITHM_ARGON2ID) {
      throw new Error(`Unsupported secret hash algorithm: ${algorithm}`);
    }
    const params = parts[2] ?? '';
    const read = (key: string): number => {
      const found = params.split(',').find((p) => p.startsWith(`${key}=`));
      if (!found) throw new Error(`Missing ${key} in encoded hash parameters`);
      const n = Number(found.slice(key.length + 1));
      if (!Number.isFinite(n)) throw new Error(`Invalid ${key} in encoded hash parameters`);
      return n;
    };
    const memory = read('m');
    const passes = read('t');
    const parallelism = read('p');
    const saltB64 = parts[3] ?? '';
    const hashB64 = parts[4] ?? '';
    const tagLength = Buffer.from(hashB64, 'base64').byteLength;
    return new SecretHash(
      encoded,
      { memory, passes, parallelism, tagLength },
      algorithm,
    );
  }

  equals(other: SecretHash): boolean {
    return this.encoded === other.encoded;
  }

  toString(): string {
    return this.encoded;
  }
}
