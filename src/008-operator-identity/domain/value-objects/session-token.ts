/**
 * SessionToken — the opaque credential the client holds.
 *
 * INVARIANT I-2: the token is opaque. It carries no operator id, no role
 * and no expiry, and it CANNOT be decoded to reveal one.
 *
 * This is enforced by the ABSENCE of operations. There is no `decode`, no
 * `payload`, no `claims`, no `operatorId` getter. The only things the type
 * can do with its value are compare it and stringify it. A token inspected
 * by anyone — including a future developer who wants to know which operator
 * it belongs to — is 256 bits of random data.
 *
 * The raw token is NEVER persisted (ADR-002). The server stores a SHA-256
 * digest of it and looks the session up by that digest.
 */
export class SessionToken {
  /**
   * @param value the raw token. Only the infrastructure's token generator
   *   should call this — it is public so the adapter can construct one,
   *   but nothing else in the system needs to.
   */
  constructor(private readonly value: string) {
    if (value.length === 0) {
      throw new Error('SessionToken must not be empty');
    }
  }

  /** Expose the raw value ONLY for hashing and for transport to the client. */
  get raw(): string {
    return this.value;
  }

  equals(other: SessionToken): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
