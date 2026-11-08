/**
 * WeighingRecordRepository — the durable record of a completed weighing.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A record describes something that physically happened (BRD DR-02), so
 * there is no update path and no delete path here — and the database's
 * triggers are the second line of the same guarantee. A repository
 * convention holds against a careless caller; a trigger holds against
 * everyone (ADR-034).
 *
 * **And a correction is a NEW row** carrying `corrects_record_id`. The
 * original is untouched (C-12).
 */
import type { WeighingRecord } from '../entities/weighing-record.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export interface WeighingRecordRepository {
  /**
   * Record a completed weighing.
   *
   * INSERT ONLY. The row's identifier is assigned by the caller — it is a
   * **uuid**, not an insertion sequence, because the record's identity is
   * its own and not the database's (BRD §9.2).
   */
  save(record: WeighingRecord): Promise<void>;

  /**
   * The record for a component in a session — the effective one.
   *
   * `null` when the component has not been confirmed. An unconfirmed
   * component is a **state**, not an error.
   */
  latestFor(
    sessionId: string,
    componentId: ComponentId,
  ): Promise<WeighingRecord | null>;

  /**
   * Has this component already been confirmed in this session?
   *
   * The **idempotence** check: a replayed confirmation must not write a
   * second record.
   */
  existsFor(
    sessionId: string,
    componentId: ComponentId,
  ): Promise<boolean>;

  /**
   * EVERY confirmed record in a session, in **recipe order**.
   *
   * **This is the read the ticket's lines come from** — and it is a read
   * of the *confirmed* records only, so an abandoned attempt appears
   * nowhere (BRD FR-17).
   *
   * And the quantities it returns are the **records' own strings**, so the
   * ticket's quantities are identical to the recorded weighings by
   * construction (NFR-2, BRD NFR-16).
   */
  allFor(sessionId: string): Promise<readonly WeighingRecord[]>;

  /**
   * EVERY record weighed within a period — the report's read.
   *
   * **And it returns the records' own quantities**, so a report row is
   * identical to the recorded weighing (BRD FR-18, FR-23).
   *
   * **And it is period-scoped by the record's own `weighedAt`** — so the
   * period selects what happened then, and a later configuration or
   * recipe revision cannot change what the report says happened (ADR-046).
   */
  between(
    from: Date,
    to: Date,
  ): Promise<readonly WeighingRecord[]>;
}
