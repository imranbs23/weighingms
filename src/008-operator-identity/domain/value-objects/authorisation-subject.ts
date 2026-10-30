/**
 * AuthorisationSubject — the specific thing an authorisation applies to.
 *
 * OPAQUE TO THIS CONTEXT
 * ----------------------
 * The subject is compared for equality and nothing else. This context does
 * not parse it, does not resolve it, and does not know what a "component"
 * or a "session" is. That is deliberate: the weighing domain belongs to
 * unit 003, and letting unit 003's vocabulary leak in here would couple two
 * units that are meant to stay separate.
 *
 * The composition of the subject (unit 003 uses "the specific componentId
 * in the specific sessionId") is the CALLER's business. This value object
 * only guarantees that it is non-empty and that it compares exactly.
 */
export class AuthorisationSubject {
  private constructor(readonly value: string) {}

  static create(raw: string): AuthorisationSubject {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('AuthorisationSubject must not be empty');
    }
    if (value.length > 256) {
      throw new Error('AuthorisationSubject must not exceed 256 characters');
    }
    return new AuthorisationSubject(value);
  }

  /**
   * Reconstruct a subject from persisted data.
   *
   * THROWS on an empty stored value rather than defaulting — a subject that
   * is somehow blank must not become a scope that matches everything.
   */
  static fromStored(raw: string): AuthorisationSubject {
    return AuthorisationSubject.create(raw);
  }

  equals(other: AuthorisationSubject): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
