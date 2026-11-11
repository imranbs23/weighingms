/**
 * SqliteWeighingRecordRepository — the durable record of a completed
 * weighing.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite a record (BRD DR-02, C-12). The database's triggers are
 * the second line of the same guarantee — a repository convention holds
 * against a careless caller; a trigger holds against everyone (ADR-034).
 *
 * **And a correction is a NEW row** carrying `corrects_record_id`. The
 * original is untouched.
 */
import { WeighingRecord } from '../../domain/entities/weighing-record.js';
import {
  isRecordedTareSource,
  type RecordedTare,
} from '../../domain/value-objects/recorded-tare.js';
import type { WeighingRecordRepository } from '../../domain/ports/weighing-record-repository.js';
import { isToleranceZone } from '../../domain/value-objects/tolerance-zone.js';
import {
  ComponentId,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { Tolerance } from '../../../005-orgatex-integration/domain/value-objects/tolerance.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleClass } from '../../../004-scale-integration/domain/value-objects/scale-capability.js';
import type { SqliteDatabase } from './record-database.js';

interface RecordRow {
  record_id: string;
  session_id: string;
  component_id: string;
  actual_quantity: string;
  unit: string;
  target_at_weighing: string;
  tolerance_at_weighing: string | null;
  zone_at_confirm: string;
  scale_id: string;
  scale_class: string;
  lot_number: string | null;
  container_id: string | null;
  operator_id: string;
  weighed_at: string;
  recorded_at: string;
  corrects_record_id: string | null;
  tare_weight: string | null;
  tare_unit: string | null;
  tare_source: string | null;
}

export class SqliteWeighingRecordRepository
  implements WeighingRecordRepository
{
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
  async save(record: WeighingRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO weighing_records
           (record_id, session_id, component_id, actual_quantity, unit,
            target_at_weighing, tolerance_at_weighing, zone_at_confirm,
            scale_id, scale_class, lot_number, container_id, operator_id,
            weighed_at, recorded_at, corrects_record_id,
            tare_weight, tare_unit, tare_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.recordId,
        record.sessionId,
        record.componentId.value,
        record.actualQuantity.toJSON(),
        record.actualQuantity.unit,
        record.targetAtWeighing.toJSON(),
        record.toleranceAtWeighing === null
          ? null
          : `${record.toleranceAtWeighing.min.text}:${record.toleranceAtWeighing.max.text}`,
        record.zoneAtConfirm,
        record.scaleId.value,
        record.scaleClass,
        record.lotNumber,
        record.containerId,
        record.operatorId.value,
        record.weighedAt.toString(),
        this.clock().toISOString(),
        record.correctsRecordId,
        record.tare?.weight.toJSON() ?? null,
        record.tare?.weight.unit ?? null,
        record.tare?.source ?? null,
      );
  }

  /**
   * The record for a component in a session — the effective one.
   *
   * `null` when the component has not been confirmed. An unconfirmed
   * component is a **state**, not an error.
   */
  async latestFor(
    sessionId: string,
    componentId: ComponentId,
  ): Promise<WeighingRecord | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM weighing_records
          WHERE session_id = ? AND component_id = ?
          ORDER BY weighed_at DESC, recorded_at DESC
          LIMIT 1`,
      )
      .get(sessionId, componentId.value) as unknown as RecordRow | undefined;

    return row === undefined ? null : toRecord(row);
  }

  /**
   * Has this component already been confirmed in this session?
   *
   * The **idempotence** check: a replayed confirmation must not write a
   * second record.
   */
  async existsFor(
    sessionId: string,
    componentId: ComponentId,
  ): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM weighing_records
          WHERE session_id = ? AND component_id = ?
          LIMIT 1`,
      )
      .get(sessionId, componentId.value);
    return row !== undefined;
  }

  /**
   * EVERY confirmed record in a session, in **recipe order**.
   *
   * **This is the read the ticket's lines come from** — and it returns the
   * records' **own** quantity strings, so the ticket's quantities are
   * identical to the recorded weighings (NFR-2, BRD NFR-16).
   *
   * And only the **effective** record for each component — a correction
   * replaces its original in the ticket, because the ticket states what
   * was weighed, and a correction states what was weighed *instead*.
   */
  async allFor(sessionId: string): Promise<readonly WeighingRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM weighing_records
          WHERE session_id = ?
            AND corrects_record_id IS NULL
          ORDER BY weighed_at ASC, recorded_at ASC`,
      )
      .all(sessionId) as unknown as RecordRow[];

    return rows.map((row) => toRecord(row));
  }

  /**
   * EVERY record weighed within a period — the report's read.
   *
   * **And it is period-scoped by the record's own `weighed_at`** — so the
   * period selects what happened then, and a later configuration or recipe
   * revision cannot change what the report says happened (ADR-046).
   *
   * **And it includes the CORRECTIONS** — a correction is a new record
   * that references the original, and both are visible through their
   * reference. The report does **not** merge or overwrite either.
   */
  async between(
    from: Date,
    to: Date,
  ): Promise<readonly WeighingRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM weighing_records
          WHERE weighed_at >= ? AND weighed_at <= ?
          ORDER BY weighed_at ASC, recorded_at ASC`,
      )
      .all(from.toISOString(), to.toISOString()) as unknown as RecordRow[];

    return rows.map((row) => toRecord(row));
  }
}

/**
 * Read the tolerance band back from its stored form.
 *
 * The band is stored as `min:max` — the MES's own two bounds (BRD §9.2),
 * because a band is **not** a deviation and the two are not the same shape.
 */
function bandFrom(stored: string, unit: string): Tolerance {
  const [min, max] = stored.split(':');
  if (min === undefined || max === undefined) {
    throw new Error(`The stored tolerance band "${stored}" is malformed`);
  }
  return Tolerance.of(WeightValue.of(min, unit), WeightValue.of(max, unit));
}

/**
 * Rebuild a record from its row.
 *
 * The zone is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toRecord(row: RecordRow): WeighingRecord {
  if (!isToleranceZone(row.zone_at_confirm)) {
    throw new Error(
      `The stored zone "${row.zone_at_confirm}" is not one this product records`,
    );
  }

  return new WeighingRecord(
    row.record_id,
    row.session_id,
    ComponentId.create(row.component_id),
    WeightValue.of(row.actual_quantity, row.unit),
    WeightValue.of(row.target_at_weighing, row.unit),
    row.tolerance_at_weighing === null
      ? null
      : bandFrom(row.tolerance_at_weighing, row.unit),
    row.zone_at_confirm,
    ScaleId.create(row.scale_id),
    row.scale_class as ScaleClass,
    row.lot_number,
    row.container_id,
    OperatorId.create(row.operator_id),
    Instant.of(new Date(row.weighed_at)),
    row.corrects_record_id,
    tareFrom(row),
  );
}

/**
 * The record's tare, or `null` — a row written before migration 037 has
 * none, and the source is read back through the domain's guard.
 */
function tareFrom(row: RecordRow): RecordedTare | null {
  if (row.tare_weight === null || row.tare_unit === null || row.tare_source === null) {
    return null;
  }
  if (!isRecordedTareSource(row.tare_source)) {
    throw new Error(`The stored tare source "${row.tare_source}" is not one this product records`);
  }
  return { weight: WeightValue.of(row.tare_weight, row.tare_unit), source: row.tare_source };
}
