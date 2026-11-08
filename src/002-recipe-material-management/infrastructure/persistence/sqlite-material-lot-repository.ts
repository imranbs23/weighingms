/**
 * SqliteMaterialLotRepository — the durable record of a lot capture.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE. AND THE LOT IS NOT DE-DUPLICATED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite a capture (BRD DR-02). The database's triggers are the
 * second line of the same guarantee (ADR-034).
 *
 * **The lot is NOT de-duplicated.** A lot may legitimately serve several
 * components, and the story requires both captures to be stored — so there
 * is no uniqueness constraint, and this repository does not look one up
 * before writing.
 *
 * THE EFFECTIVE CAPTURE IS THE NEWEST ROW
 * ----------------------------------------
 * `captured_at DESC, id DESC` — a **total** order, so "the latest" has
 * exactly one answer. And the superseded capture is **retained**, which is
 * what the story requires.
 */
import { MaterialLotCapture } from '../../domain/entities/material-lot-capture.js';
import type { MaterialLotRepository } from '../../domain/ports/material-lot-repository.js';
import { isCaptureMethod } from '../../domain/value-objects/capture-method.js';
import {
  ComponentId,
  DyestuffCode,
  LotNumber,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SqliteDatabase } from './material-database.js';

interface LotRow {
  id: number;
  component_id: string;
  lot_number: string;
  material_code: string;
  capture_method: string;
  captured_by: string;
  captured_at: string;
  recorded_at: string;
}

export class SqliteMaterialLotRepository implements MaterialLotRepository {
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The row's identifier is the **insertion sequence**, and it is what
   * breaks a tie when two captures land in the same millisecond.
   */
  async save(capture: MaterialLotCapture): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO material_lot_captures
           (component_id, lot_number, material_code,
            capture_method, captured_by, captured_at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        capture.componentId.value,
        capture.lotNumber.value,
        capture.materialCode.value,
        capture.captureMethod,
        capture.capturedBy.value,
        capture.capturedAt.toString(),
        this.clock().toISOString(),
      );
  }

  /**
   * The newest capture for a component — the effective one.
   *
   * `null` when no lot has been captured yet. An uncaptured component is a
   * **state**, not an error.
   */
  async latestFor(
    componentId: ComponentId,
  ): Promise<MaterialLotCapture | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM material_lot_captures
          WHERE component_id = ?
          ORDER BY captured_at DESC, id DESC
          LIMIT 1`,
      )
      .get(componentId.value) as unknown as LotRow | undefined;

    return row === undefined ? null : toCapture(row);
  }
}

/**
 * Rebuild a capture from its row.
 *
 * The method is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toCapture(row: LotRow): MaterialLotCapture {
  if (!isCaptureMethod(row.capture_method)) {
    throw new Error(
      `The stored capture method "${row.capture_method}" is not one this product records`,
    );
  }

  return new MaterialLotCapture(
    ComponentId.create(row.component_id),
    LotNumber.create(row.lot_number),
    DyestuffCode.create(row.material_code),
    row.capture_method,
    OperatorId.create(row.captured_by),
    Instant.of(new Date(row.captured_at)),
  );
}
