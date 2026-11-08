/**
 * SqliteOverrideRecordRepository — the durable record of an authorised
 * exception.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite an override record (BRD DR-02). The database's triggers
 * are the second line of the same guarantee (ADR-034).
 */
import { OverrideRecord } from '../../domain/entities/override-record.js';
import type { OverrideRecordRepository } from '../../domain/ports/override-ports.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { SqliteDatabase } from './override-database.js';

interface OverrideRow {
  record_id: string;
  authorisation_id: string;
  supervisor_id: string;
  operator_id: string;
  reason: string;
  component_id: string;
  session_id: string;
  surplus_amount: string;
  surplus_unit: string;
  authorised_at: string;
  recorded_at: string;
}

export class SqliteOverrideRecordRepository implements OverrideRecordRepository {
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The record's identifier is a **uuid**, assigned by the caller — it is
   * the record's own identity, not the database's (BRD §9.2).
   */
  async save(record: OverrideRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO override_records
           (record_id, authorisation_id, supervisor_id, operator_id, reason,
            component_id, session_id, surplus_amount, surplus_unit,
            authorised_at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.recordId,
        record.authorisationId,
        record.supervisorId,
        record.operatorId,
        // The reason is stored VERBATIM — it is a record, not a credential
        // (ADR-005).
        record.reason,
        record.componentId,
        record.sessionId,
        record.surplusAmount.toJSON(),
        record.surplusAmount.unit,
        record.authorisedAt.toString(),
        this.clock().toISOString(),
      );
  }

  /**
   * The newest record for a component — the effective one.
   *
   * `null` when no override has been recorded. An un-overridden component is a
   * **state**, not an error.
   */
  async latestFor(
    componentId: ComponentId,
  ): Promise<OverrideRecord | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM override_records
          WHERE component_id = ?
          ORDER BY authorised_at DESC
          LIMIT 1`,
      )
      .get(componentId.value) as unknown as OverrideRow | undefined;

    return row === undefined ? null : toRecord(row);
  }
}

/**
 * Rebuild an override record from its row.
 */
function toRecord(row: OverrideRow): OverrideRecord {
  return new OverrideRecord(
    row.record_id,
    row.authorisation_id,
    row.supervisor_id,
    row.operator_id,
    row.reason,
    row.component_id,
    row.session_id,
    WeightValue.of(row.surplus_amount, row.surplus_unit),
    Instant.of(new Date(row.authorised_at)),
  );
}
