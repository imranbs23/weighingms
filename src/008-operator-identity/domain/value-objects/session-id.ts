/**
 * SessionId — the server-side key of an identity session.
 *
 * DISTINCT FROM `SessionToken`
 * -----------------------------
 * The token is what the CLIENT holds and presents on every request; the id
 * is what the SERVER indexes by. The token is a credential; the id is not.
 *
 * The id appears on `SupervisorAuthorisation.sessionId` as a PROVENANCE
 * REFERENCE — it records how the supervisor proved themselves, for the
 * audit trail. It is NOT a capability: reading it grants no access to the
 * session, and it carries no token. (ADR-003 — the authorisation's own id
 * is likewise not a bearer credential.)
 */
export class SessionId {
  private constructor(readonly value: string) {}

  static create(raw: string): SessionId {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('SessionId must not be empty');
    }
    if (value.length > 64) {
      throw new Error('SessionId must not exceed 64 characters');
    }
    return new SessionId(value);
  }

  static fromStored(raw: string): SessionId {
    return SessionId.create(raw);
  }

  equals(other: SessionId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
