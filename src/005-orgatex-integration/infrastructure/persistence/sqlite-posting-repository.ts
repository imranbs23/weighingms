/**
 * SqlitePostingRepository — the postings table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NO GENERAL UPDATE. THE GUARD IS IN THE SQL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no `update` method, and the two mutations there are have
 * `WHERE state = 'QUEUED'` in them.
 *
 * That clause is the whole of ADR-024's enforcement. A posting that has
 * already been resolved cannot be resolved again: the UPDATE matches
 * zero rows, and this repository **raises** rather than reporting a
 * silent no-op. A silent no-op would be the worst outcome available —
 * a double-resolution would look like a success.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import {
  ConsumptionPosting,
} from '../../domain/entities/postings.js';
import type { PostingRepository } from '../../domain/ports/posting-repositories.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../domain/value-objects/identifiers.js';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.js';
import type { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import { RejectionReason as RejectionReasonClass } from '../../domain/value-objects/rejection-reason.js';
import type { PostingState } from '../../domain/value-objects/posting-state.js';
import type { SqliteDatabase } from './orgatex-database.js';

interface PostingRow {
  id: string;
  batch_id: string;
  component_id: string;
  actual_quantity: string;
  unit: string;
  lot_number: string;
  operator_id: string;
  weighed_at: string;
  created_at: string;
  state: PostingState;
  rejection_code: string | null;
  rejection_detail: string | null;
}

export class SqlitePostingRepository implements PostingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(posting: ConsumptionPosting): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO consumption_postings (
           id, batch_id, component_id, actual_quantity, unit, lot_number,
           operator_id, weighed_at, created_at, state, rejection_code, rejection_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        posting.id.value,
        posting.batchId.value,
        posting.componentId.value,
        posting.actualQuantity.toJSON(),
        posting.actualQuantity.unit,
        posting.lotNumber.value,
        posting.operatorId.value,
        posting.weighedAt.toDate().toISOString(),
        posting.createdAt.toDate().toISOString(),
        posting.state,
        posting.rejection?.code ?? null,
        posting.rejection?.detail ?? null,
      );
  }

  async findById(id: IdempotencyKey): Promise<ConsumptionPosting | null> {
    const row = this.db
      .prepare('SELECT * FROM consumption_postings WHERE id = ?')
      .get(id.value) as unknown as PostingRow | undefined;
    return row === undefined ? null : toPosting(row);
  }

  async findByBatch(batchId: BatchId): Promise<ConsumptionPosting[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM consumption_postings WHERE batch_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(batchId.value) as unknown as PostingRow[];
    return rows.map(toPosting);
  }

  /**
   * Mark a posting accepted.
   *
   * @throws when the posting is not `QUEUED`.
   */
  async markAccepted(id: IdempotencyKey, at: Instant): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE consumption_postings
            SET state = 'ACCEPTED',
                rejection_code = NULL,
                rejection_detail = NULL
          WHERE id = ? AND state = 'QUEUED'`,
      )
      .run(id.value);

    if (result.changes === 0) {
      throw new Error(
        `The posting ${id.value} is not in state QUEUED — it cannot be accepted`,
      );
    }
  }

  /**
   * Mark a posting rejected, with its reason.
   *
   * @throws when the posting is not `QUEUED`.
   */
  async markRejected(
    id: IdempotencyKey,
    reason: RejectionReason,
    at: Instant,
  ): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE consumption_postings
            SET state = 'REJECTED',
                rejection_code = ?,
                rejection_detail = ?
          WHERE id = ? AND state = 'QUEUED'`,
      )
      .run(reason.code, reason.detail, id.value);

    if (result.changes === 0) {
      throw new Error(
        `The posting ${id.value} is not in state QUEUED — it cannot be rejected`,
      );
    }
  }
}

/**
 * Rebuild a posting from its row.
 *
 * The quantity is read back as a **string** — it was stored as one, so
 * nothing is lost to a float on the way back in.
 */
function toPosting(row: PostingRow): ConsumptionPosting {
  const rejection =
    row.rejection_code === null
      ? null
      : RejectionReasonClass.of(
          row.rejection_code as RejectionReason['code'],
          row.rejection_detail ?? '',
        );

  return new ConsumptionPosting(
    IdempotencyKey.of(row.id),
    BatchId.create(row.batch_id),
    ComponentId.create(row.component_id),
    WeightValue.of(row.actual_quantity, row.unit),
    LotNumber.create(row.lot_number),
    OperatorReference.create(row.operator_id),
    Instant.of(new Date(row.weighed_at)),
    Instant.of(new Date(row.created_at)),
    row.state,
    rejection,
  );
}
