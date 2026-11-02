/**
 * SqliteBatchStatusWriteRepository — the status writes.
 *
 * The same guarded-mutation pattern as the postings: no general
 * `update`, and the two mutations carry `WHERE state = 'QUEUED'`.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { BatchStatusWrite } from '../../domain/entities/postings.js';
import type {
  BatchStatusWriteRepository,
} from '../../domain/ports/posting-repositories.js';
import { BatchId } from '../../domain/value-objects/identifiers.js';
import { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import type { PostingState } from '../../domain/value-objects/posting-state.js';
import type { SqliteDatabase } from './orgatex-database.js';

interface StatusWriteRow {
  id: string;
  batch_id: string;
  status: string;
  written_at: string;
  state: PostingState;
  rejection_code: string | null;
  rejection_detail: string | null;
}

export class SqliteBatchStatusWriteRepository
  implements BatchStatusWriteRepository
{
  constructor(private readonly db: SqliteDatabase) {}

  async save(write: BatchStatusWrite): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO batch_status_writes (
           id, batch_id, status, written_at, state, rejection_code, rejection_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        write.id,
        write.batchId.value,
        write.status,
        write.writtenAt.toDate().toISOString(),
        write.state,
        write.rejection?.code ?? null,
        write.rejection?.detail ?? null,
      );
  }

  async findById(id: string): Promise<BatchStatusWrite | null> {
    const row = this.db
      .prepare('SELECT * FROM batch_status_writes WHERE id = ?')
      .get(id) as unknown as StatusWriteRow | undefined;
    return row === undefined ? null : toStatusWrite(row);
  }

  async findByBatch(batchId: BatchId): Promise<BatchStatusWrite[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM batch_status_writes WHERE batch_id = ? ORDER BY written_at ASC, id ASC',
      )
      .all(batchId.value) as unknown as StatusWriteRow[];
    return rows.map(toStatusWrite);
  }

  async markAccepted(id: string, at: Instant): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE batch_status_writes
            SET state = 'ACCEPTED',
                rejection_code = NULL,
                rejection_detail = NULL
          WHERE id = ? AND state = 'QUEUED'`,
      )
      .run(id);

    if (result.changes === 0) {
      throw new Error(
        `The status write ${id} is not in state QUEUED — it cannot be accepted`,
      );
    }
  }

  async markRejected(
    id: string,
    reason: RejectionReason,
    at: Instant,
  ): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE batch_status_writes
            SET state = 'REJECTED',
                rejection_code = ?,
                rejection_detail = ?
          WHERE id = ? AND state = 'QUEUED'`,
      )
      .run(reason.code, reason.detail, id);

    if (result.changes === 0) {
      throw new Error(
        `The status write ${id} is not in state QUEUED — it cannot be rejected`,
      );
    }
  }
}

function toStatusWrite(row: StatusWriteRow): BatchStatusWrite {
  const rejection =
    row.rejection_code === null
      ? null
      : RejectionReason.of(
          row.rejection_code as RejectionReason['code'],
          row.rejection_detail ?? '',
        );

  return new BatchStatusWrite(
    row.id,
    BatchId.create(row.batch_id),
    row.status as BatchStatusWrite['status'],
    Instant.of(new Date(row.written_at)),
    row.state,
    rejection,
  );
}
