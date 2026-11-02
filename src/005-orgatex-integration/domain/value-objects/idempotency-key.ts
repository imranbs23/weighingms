/**
 * IdempotencyKey — the identity of a consumption posting, and the thing
 * that makes a retry safe.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A KEY, NOT A SECRET — AND NOT GUESSABLE EITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The key is **carried on the request**, so the MES can deduplicate if it
 * does (ADR-025). That makes it non-secret: it is not a credential, and
 * treating it as one would be a category error.
 *
 * But it is **not guessable**. A guessable key would let a third party
 * replay a posting and double-count a consumption — which is the exact
 * failure this whole mechanism exists to prevent.
 *
 * So the key is a truncated SHA-256 of the weighing record's identity:
 * unpredictable, and carrying nothing about the weighing it identifies.
 */

/** The longest key this seam will accept. */
const MAX_KEY_LENGTH = 64;

/** The shape every key must have. */
const KEY_PATTERN = /^IDK-[0-9a-f]{16}$/;

export class IdempotencyKey {
  private constructor(readonly value: string) {}

  /**
   * Build a key from an already-derived value.
   *
   * The shape is checked, so a malformed key cannot be constructed — and
   * therefore cannot be persisted, sent or logged.
   *
   * The length is checked FIRST, so an over-long key gets the message
   * that says what is wrong with it. The shape check subsumes it — a
   * key of the right shape is 20 characters — but the order matters for
   * the message, not for the outcome.
   */
  static of(value: string): IdempotencyKey {
    const trimmed = value.trim();
    if (trimmed.length > MAX_KEY_LENGTH) {
      throw new Error(
        `An idempotency key must not exceed ${MAX_KEY_LENGTH} characters`,
      );
    }
    if (!KEY_PATTERN.test(trimmed)) {
      throw new Error(
        'An idempotency key must be "IDK-" followed by 16 lowercase hex characters',
      );
    }
    return new IdempotencyKey(trimmed);
  }

  equals(other: IdempotencyKey): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
