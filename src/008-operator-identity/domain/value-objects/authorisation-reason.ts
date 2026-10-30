/**
 * AuthorisationReason — the mandatory justification.
 *
 * INVARIANT A-3: a reason is present and meaningful.
 *
 * THE RULE IS IN THE CONSTRUCTOR
 * ------------------------------
 * This value object CANNOT be constructed from an empty string, a
 * whitespace-only string, or a string containing nothing but punctuation.
 * A missing justification is therefore a *construction failure* at the
 * boundary — a type-level fact — rather than a runtime check that a call
 * site could forget to perform.
 *
 * The rule is "must contain a letter or a digit", not "must be long". A
 * length minimum would reject legitimate short justifications ("ok per
 * customer") and would be a formatting rule masquerading as a substantive
 * one. What matters is that SOMETHING was actually said.
 *
 * WHY PUNCTUATION-ONLY IS REFUSED
 * -------------------------------
 * The story's edge cases say "The reason contains only punctuation or
 * whitespace → Refused — no meaningful justification has been given". A
 * reason of "!!!" or "..." records the appearance of a justification while
 * providing none, and an audit row full of them is worth nothing.
 *
 * NOTE ON STORAGE
 * ---------------
 * The reason is stored in CLEAR TEXT (ADR-005). It is a record, not a
 * credential: it authorises nothing, and it must be readable by an auditor
 * years later. The meaningfulness check below is a *validation* rule about
 * the completeness of the record — it has nothing to do with how the text
 * is stored.
 */
export class AuthorisationReason {
  private constructor(readonly value: string) {}

  static create(raw: string): AuthorisationReason {
    // Surrounding whitespace is trimmed. Nothing else is altered — the
    // stored text is the supervisor's own words, not a paraphrase.
    const value = raw.trim();

    if (value.length === 0) {
      throw new Error('AuthorisationReason must not be empty');
    }
    if (value.length > 1000) {
      throw new Error('AuthorisationReason must not exceed 1000 characters');
    }
    if (!AuthorisationReason.hasContent(value)) {
      throw new Error(
        'AuthorisationReason must contain a letter or a digit — punctuation ' +
          'and whitespace alone are not a justification',
      );
    }
    return new AuthorisationReason(value);
  }

  /**
   * Reconstruct a reason from persisted data.
   *
   * THROWS on a stored value that is not meaningful. A corrupted row must
   * not become a record that appears to carry a justification it does not.
   */
  static fromStored(raw: string): AuthorisationReason {
    return AuthorisationReason.create(raw);
  }

  /**
   * Does the text contain at least one letter or digit?
   *
   * A Unicode-aware test: a justification written in a non-Latin script
   * contains letters, and must not be refused merely because those letters
   * are not ASCII.
   */
  private static hasContent(value: string): boolean {
    return /[\p{L}\p{N}]/u.test(value);
  }

  equals(other: AuthorisationReason): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
