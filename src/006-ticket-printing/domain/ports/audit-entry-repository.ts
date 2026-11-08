/**
 * The audit trail's port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO UPDATE PATH AND NO DELETE PATH. AND THAT IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's success criterion is explicit:
 *
 * > *"The success criterion is a test asserting that **no update or delete
 * > path exists on the repository**, not a convention that callers
 * > remember."*
 *
 * So the interface has `record`, `all` and `filter` — and **no mutator**.
 * There is nothing to call that would change history.
 *
 * **And the database enforces it too** — `BEFORE UPDATE` and `BEFORE
 * DELETE` triggers that abort. The interface's shape stops a well-meaning
 * caller; the triggers stop **everyone** (BRD NFR-13, ADR-034).
 */
import type { AuditEntry } from '../entities/audit-entry.js';

/** The filter a query uses. */
export interface AuditFilter {
  /** The actor — `null` means any. */
  readonly actorId?: string | null;
  /** The action — `null` means any. */
  readonly action?: string | null;
  /** The start of the range — inclusive. */
  readonly from?: Date | null;
  /** The end of the range — inclusive. */
  readonly to?: Date | null;
}

export interface AuditEntryRepository {
  /**
   * Record a privileged action.
   *
   * **INSERT ONLY.** The row's `sequence` is assigned by the database — the
   * trail's order is authoritative and cannot tie (ADR-043).
   */
  record(entry: AuditEntry): Promise<void>;

  /**
   * Every entry, in **sequence order**.
   *
   * The order is the sequence — not the timestamp — because the timestamp
   * cannot separate two actions in the same millisecond.
   */
  all(): Promise<readonly AuditEntry[]>;

  /**
   * The matching entries, in **sequence order**.
   *
   * An empty result is an empty array — never an error. An empty trail and
   * an unreachable one are different facts, and this method reports the
   * first.
   */
  filter(filter: AuditFilter): Promise<readonly AuditEntry[]>;
}

/**
 * The trail, as a CURSOR.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CURSOR, NOT AN ARRAY — BECAUSE THE EXPORT MUST NOT BE HELD IN ONE
 * BUFFER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge case: *"An export is requested for a multi-year range
 * → the export is produced from the store **without loading every entry
 * into memory in one buffer**."*
 *
 * So `filter` — which returns an array — is right for the **query** and
 * wrong for the **export**. And this is the **second** read path, so the
 * two must agree — and their agreement is a test's responsibility, not the
 * type system's (ADR-044).
 */
export interface AuditStreamRepository {
  /**
   * The matching entries, **one at a time**.
   *
   * In **sequence order** — the trail's authoritative order.
   */
  stream(filter: AuditFilter): AsyncIterable<AuditEntry>;
}
