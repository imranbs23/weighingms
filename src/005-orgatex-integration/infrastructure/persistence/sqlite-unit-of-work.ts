/**
 * SqliteUnitOfWork — the transaction boundary for the write path.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TRANSACTION, THREE WRITES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The posting, the attempt and — on acceptance — the ledger entry are
 * committed together, or not at all.
 *
 * The design's reasoning: a ledger entry without its posting means a
 * retry is refused as a duplicate and the consumption is **never sent**;
 * a posting without its attempt leaves a hole in the diagnostic history
 * IR-09 depends on. Three separate commits have three separate crash
 * windows; one commit has none.
 *
 * THE LEDGER'S CONSTRAINT IS THE DUPLICATE REFUSAL
 * -------------------------------------------------
 * The ledger row is inserted with the key as its PRIMARY KEY, and the
 * insert is the last statement in the transaction. If the key is
 * already present, SQLite raises a UNIQUE violation, the transaction
 * rolls back, and the duplicate is refused — **atomically** (ADR-023).
 *
 * So the refusal is not a read-then-write. There is no window.
 */
import type {
  UnitOfWork,
  PostingCommit,
  StatusWriteCommit,
} from '../../domain/ports/posting-repositories.js';
import type { SqliteDatabase } from './orgatex-database.js';

export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly db: SqliteDatabase) {}

  async commit(change: PostingCommit): Promise<void> {
    const db = this.db;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (change.kind === 'ACCEPTED') {
        db.prepare(
          `UPDATE consumption_postings
              SET state = 'ACCEPTED',
                  rejection_code = NULL,
                  rejection_detail = NULL
            WHERE id = ? AND state = 'QUEUED'`,
        ).run(change.posting.id.value);

        db.prepare(
          `INSERT INTO posting_attempts (
             id, posting_id, attempted_at, outcome, reason_code, reason_detail
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          change.attempt.id,
          change.attempt.postingId.value,
          change.attempt.attemptedAt.toDate().toISOString(),
          change.attempt.outcome,
          change.attempt.reason?.code ?? null,
          change.attempt.reason?.detail ?? null,
        );

        // The ledger row is inserted LAST, so the transaction's
        // constraint violation is the last thing to happen — and it
        // rolls back the state transition with it.
        db.prepare(
          `INSERT INTO idempotency_ledger (idempotency_key, posting_id, recorded_at)
           VALUES (?, ?, ?)`,
        ).run(
          change.ledgerKey.value,
          change.posting.id.value,
          change.ledgerAt.toDate().toISOString(),
        );
      } else if (change.kind === 'REJECTED') {
        db.prepare(
          `UPDATE consumption_postings
              SET state = 'REJECTED',
                  rejection_code = ?,
                  rejection_detail = ?
            WHERE id = ? AND state = 'QUEUED'`,
        ).run(
          change.attempt.reason?.code ?? null,
          change.attempt.reason?.detail ?? null,
          change.posting.id.value,
        );

        db.prepare(
          `INSERT INTO posting_attempts (
             id, posting_id, attempted_at, outcome, reason_code, reason_detail
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          change.attempt.id,
          change.attempt.postingId.value,
          change.attempt.attemptedAt.toDate().toISOString(),
          change.attempt.outcome,
          change.attempt.reason?.code ?? null,
          change.attempt.reason?.detail ?? null,
        );
      } else {
        // PENDING — the posting stays QUEUED. The attempt records the
        // ambiguity, and the ledger is NOT written: a QUEUED posting's
        // key is not consumed.
        db.prepare(
          `INSERT INTO posting_attempts (
             id, posting_id, attempted_at, outcome, reason_code, reason_detail
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          change.attempt.id,
          change.attempt.postingId.value,
          change.attempt.attemptedAt.toDate().toISOString(),
          change.attempt.outcome,
          change.attempt.reason?.code ?? null,
          change.attempt.reason?.detail ?? null,
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async commitStatusWrite(change: StatusWriteCommit): Promise<void> {
    const db = this.db;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (change.kind === 'ACCEPTED') {
        db.prepare(
          `UPDATE batch_status_writes
              SET state = 'ACCEPTED',
                  rejection_code = NULL,
                  rejection_detail = NULL
            WHERE id = ? AND state = 'QUEUED'`,
        ).run(change.write.id);
      } else if (change.kind === 'REJECTED') {
        db.prepare(
          `UPDATE batch_status_writes
              SET state = 'REJECTED',
                  rejection_code = ?,
                  rejection_detail = ?
            WHERE id = ? AND state = 'QUEUED'`,
        ).run(change.reason.code, change.reason.detail, change.write.id);
      }
      // PENDING — the write stays QUEUED. The MES did not answer, so the
      // write is not resolved.
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
