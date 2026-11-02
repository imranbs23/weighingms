/**
 * IdempotencyKeyFactory — derives a posting's key from the weighing
 * record's identity.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DERIVED FROM THE WEIGHING, NOT FROM THE COMPONENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge case is explicit:
 *
 * > "The operator confirms the same component twice | The second
 * > confirmation is a distinct weighing record with a distinct key; the
 * > key is derived from the weighing record's identity, not from the
 * > component."
 *
 * Deriving from the component alone would make the second confirmation a
 * **duplicate** of the first. The second weighing would be refused, and
 * its consumption would **never be sent** — a lost consumption on a real
 * order, the mirror-image failure of the double-post this mechanism
 * exists to prevent.
 *
 * So the identity is the weighing's: batch, component, operator and the
 * time it was weighed. Confirm the same component twice at two different
 * times, or by two different operators, and the keys differ.
 *
 * WHY THIS IS A DOMAIN SERVICE
 * ----------------------------
 * Because the derivation encodes a **business rule**, and a business
 * rule belongs in the domain where it can be tested without a database
 * or a MES.
 */
import { createHash } from 'node:crypto';
import { IdempotencyKey } from '../value-objects/idempotency-key.js';
import type { BatchId } from '../value-objects/identifiers.js';
import type { ComponentId } from '../value-objects/identifiers.js';
import type { OperatorReference } from '../value-objects/identifiers.js';

/**
 * The weighing's identity — what the key is derived from.
 *
 * A narrow interface rather than unit 003's weighing record, because this
 * bolt needs the weighing's **identity** and nothing else. The content
 * of the weighing is unit 003's business; the *fact* that it happened is
 * all the key needs.
 */
export interface WeighingIdentity {
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly operatorId: OperatorReference;
  /** The time of the weighing, as an ISO-8601 instant. */
  readonly weighedAt: string;
}

export class IdempotencyKeyFactory {
  /**
   * Derive the key for a weighing.
   *
   * The identity is joined with a separator that cannot appear in an
   * identifier, so that two different identities cannot produce the same
   * joined string. A `|` would do it; the identifiers are bounded and
   * trimmed, and a `|` is not a legal character in any of them.
   */
  static derive(identity: WeighingIdentity): IdempotencyKey {
    const canonical = [
      identity.batchId.value,
      identity.componentId.value,
      identity.operatorId.value,
      identity.weighedAt,
    ].join('|');

    return IdempotencyKey.of(toKey(canonical));
  }
}

/**
 * The key's digest.
 *
 * Truncated to 16 hex characters (64 bits).
 *
 * A collision would mean two different weighings share a key, and the
 * second would be refused as a duplicate — a lost consumption. 64 bits
 * gives a birthday bound of roughly 4 billion postings for a 50% chance
 * of one collision, and a dyehouse does thousands a year. A full 256-bit
 * key would be longer to store, carry and log for no operational gain.
 */
function toKey(canonical: string): string {
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `IDK-${digest.slice(0, 16)}`;
}
