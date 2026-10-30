/**
 * Argon2SecretHasher — the only implementation of the SecretHasher port.
 *
 * Uses Node's built-in `crypto.argon2Sync` (ADR-001). No npm package, no
 * native build step.
 *
 * ⚠️ THE API TRAP (from ADR-001): Node's signature is
 * `argon2Sync(algorithm, parameters)`, and the parameter names DIFFER from
 * every common npm argon2 package:
 *
 *   Node built-in          npm package
 *   ─────────────          ───────────
 *   message                password
 *   nonce                  salt
 *   memory                 memoryCost
 *   passes                 timeCost
 *   parallelism            parallelism
 *   tagLength              hashLength
 *   type (1st positional)  type (in options)
 *
 * Using the npm names against Node's API fails with a misleading error
 * about the "algorithm" argument, because the first positional argument is
 * the VARIANT, not the password.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import {
  SECRET_HASH_ALGORITHM_ARGON2ID,
  SecretHash,
} from '../../domain/value-objects/secret-hash.js';
import type { SecretHasher } from '../../domain/ports/secret-hasher.js';

export interface Argon2Options {
  /** Memory cost in KiB. */
  readonly memory: number;
  /** Number of passes over memory. */
  readonly passes: number;
  /** Degree of parallelism. */
  readonly parallelism: number;
  /** Derived key length in bytes. */
  readonly tagLength: number;
  /** Salt length in bytes. */
  readonly saltLength: number;
}

/**
 * The OWASP / RFC 9106 recommended Argon2id profile.
 *
 * 19 MiB, 2 passes, parallelism 1. ~55 ms per hash on this machine.
 */
export const DEFAULT_ARGON2_OPTIONS: Argon2Options = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  saltLength: 16,
};

export class Argon2SecretHasher implements SecretHasher {
  constructor(private readonly options: Argon2Options = DEFAULT_ARGON2_OPTIONS) {}

  hash(secret: string): SecretHash {
    const salt = randomBytes(this.options.saltLength);
    const digest = this.derive(secret, salt);
    const encoded = this.encode(salt, digest);
    return SecretHash.fromEncoded(
      encoded,
      {
        memory: this.options.memory,
        passes: this.options.passes,
        parallelism: this.options.parallelism,
        tagLength: this.options.tagLength,
      },
      SECRET_HASH_ALGORITHM_ARGON2ID,
    );
  }

  /**
   * Verify a presented secret against a stored hash.
   *
   * Performs the FULL derivation cost on a mismatch — it does not
   * short-circuit. A fast-fail here would be a timing oracle, and the
   * "wrong secret" path would be measurably cheaper than the "unknown
   * operator" path if the caller skipped the verification entirely.
   */
  verify(hash: SecretHash, presentedSecret: string): boolean {
    const parsed = SecretHash.parse(hash.encoded);
    const { salt, digest } = this.decode(parsed.encoded);
    const candidate = this.deriveWith(
      presentedSecret,
      salt,
      parsed.parameters.memory,
      parsed.parameters.passes,
      parsed.parameters.parallelism,
      parsed.parameters.tagLength,
    );
    // Constant-time comparison — a byte-by-byte early-return comparison
    // would leak the length of the matching prefix.
    return this.timingSafeEqual(candidate, digest);
  }

  /**
   * Derive a digest with the configured parameters.
   */
  private derive(secret: string, salt: Buffer): Buffer {
    return this.deriveWith(
      secret,
      salt,
      this.options.memory,
      this.options.passes,
      this.options.parallelism,
      this.options.tagLength,
    );
  }

  private deriveWith(
    secret: string,
    salt: Buffer,
    memory: number,
    passes: number,
    parallelism: number,
    tagLength: number,
  ): Buffer {
    return argon2Sync(SECRET_HASH_ALGORITHM_ARGON2ID, {
      message: Buffer.from(secret, 'utf8'),
      nonce: salt,
      memory,
      passes,
      parallelism,
      tagLength,
    });
  }

  /**
   * The self-describing encoding:
   *   $argon2id$m=<memory>,t=<passes>,p=<parallelism>$<saltB64>$<hashB64>
   */
  private encode(salt: Buffer, digest: Buffer): string {
    const params = `m=${this.options.memory},t=${this.options.passes},p=${this.options.parallelism}`;
    return [
      '',
      SECRET_HASH_ALGORITHM_ARGON2ID,
      params,
      salt.toString('base64'),
      digest.toString('base64'),
    ].join('$');
  }

  private decode(encoded: string): { salt: Buffer; digest: Buffer } {
    const parts = encoded.split('$');
    if (parts.length !== 5) {
      throw new Error('Malformed encoded secret hash');
    }
    return {
      salt: Buffer.from(parts[3] ?? '', 'base64'),
      digest: Buffer.from(parts[4] ?? '', 'base64'),
    };
  }

  /**
   * Length-safe, constant-time byte comparison.
   *
   * `timingSafeEqual` requires equal lengths, so a length mismatch is
   * reported as "not equal" without leaking anything through an early
   * return. The digest length is fixed by the stored parameters, so the
   * lengths always match for a well-formed hash.
   */
  private timingSafeEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i]! ^ b[i]!;
    }
    return diff === 0;
  }
}
