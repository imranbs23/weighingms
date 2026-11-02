/**
 * SqlitePostingAttemptRepository — the append-only attempt history.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. THERE IS NO UPDATE AND NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The interface has no such methods, so this class has none either. The
 * absence is the guarantee — a future caller cannot rewrite history
 * even by accident.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { PostingAttempt } from '../../domain/entities/postings.js';
import type {
  PostingAttemptRepository,
} from '../../domain/ports/posting-repositories.js';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.js';
import type { AttemptOutcome } from '../../domain/value-objects/posting-state.js';
import { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import type { SqliteDatabase } from './orgatex-database.js';

interface AttemptRow {
  id: string;
  posting_id: string;
  attempted_at: string;
  outcome: AttemptOutcome;
  reason_code: string | null;
  reason_detail: string | null;
}

export class SqlitePostingAttemptRepository implements PostingAttemptRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async append(attempt: PostingAttempt): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO posting_attempts (
           id, posting_id, attempted_at, outcome, reason_code, reason_detail
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.postingId.value,
        attempt.attemptedAt.toDate().toISOString(),
        attempt.outcome,
        attempt.reason?.code ?? null,
        attempt.reason?.detail ?? null,
      );
  }

  async findByPosting(postingId: IdempotencyKey): Promise<PostingAttempt[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM posting_attempts WHERE posting_id = ? ORDER BY attempted_at ASC, id ASC',
      )
      .all(postingId.value) as unknown as AttemptRow[];

    return rows.map(
      (row) =>
        new PostingAttempt(
          row.id,
          IdempotencyKey.of(row.posting_id),
          Instant.of(new Date(row.attempted_at)),
          row.outcome,
          row.reason_code === null
            ? null
            : RejectionReason.of(
                row.reason_code as RejectionReason['code'],
                row.reason_detail ?? '',
              ),
        ),
    );
  }
}
