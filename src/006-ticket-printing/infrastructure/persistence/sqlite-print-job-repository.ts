/**
 * The print job's repository.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY IN PRACTICE — AND A SETTLED JOB MAY NOT BE EDITED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Each attempt is its **own row** — the story says so — and the database
 * refuses to update a row that has already settled (`DONE` or `FAILED`).
 * A job in `QUEUED` or `PRINTING` **can** be updated, because that is how
 * it moves.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { PrintJob, type PrintJobState } from '../../domain/entities/print-job.js';
import type { PrintJobRepository } from '../../domain/ports/ticket-ports.js';
import type { SqliteDatabase } from './ticket-database.js';

interface JobRow {
  job_id: string;
  ticket_id: string;
  state: string;
  is_reprint: number;
  reprint_of: string | null;
  reason: string | null;
  actor_id: string | null;
  actor_role: string | null;
  attempted_at: string;
  completed_at: string | null;
  error: string | null;
  recorded_at: string;
}

export class SqlitePrintJobRepository implements PrintJobRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Save the job, or its transition.
   *
   * **A settled job may not be edited** — the database refuses it, and so
   * does the aggregate.
   */
  async save(job: PrintJob): Promise<void> {
    const existing = this.db
      .prepare('SELECT job_id FROM print_jobs WHERE job_id = ? LIMIT 1')
      .get(job.jobId) as unknown as { job_id: string } | undefined;

    if (existing === undefined) {
      this.db
        .prepare(
          `INSERT INTO print_jobs
             (job_id, ticket_id, state, is_reprint, reprint_of, attempted_at,
              completed_at, error, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          job.jobId,
          job.ticketId,
          job.state,
          job.isReprint ? 1 : 0,
          job.reprintOf,
          job.attemptedAt.toString(),
          job.completedAt?.toString() ?? null,
          job.error,
          this.clock().toISOString(),
        );
      return;
    }

    // The transition — and the database refuses to edit a settled job.
    this.db
      .prepare(
        `UPDATE print_jobs
            SET state = ?, completed_at = ?, error = ?
          WHERE job_id = ?`,
      )
      .run(
        job.state,
        job.completedAt?.toString() ?? null,
        job.error,
        job.jobId,
      );
  }

  /** The job by its id — `null` when there is none. */
  async findById(jobId: string): Promise<PrintJob | null> {
    const row = this.db
      .prepare('SELECT * FROM print_jobs WHERE job_id = ? LIMIT 1')
      .get(jobId) as unknown as JobRow | undefined;

    return row === undefined ? null : toJob(row);
  }
}

/**
 * Rebuild a print job from its row.
 *
 * **And its state is restored** — so a job left in `PRINTING` by a crash
 * comes back as `PRINTING` (BRD NFR-05).
 */
function toJob(row: JobRow): PrintJob {
  const job = new PrintJob(
    row.job_id,
    row.ticket_id,
    Instant.of(new Date(row.attempted_at)),
    row.is_reprint === 1,
    row.reprint_of,
    row.reason,
    row.actor_id,
    row.actor_role,
  );

  const state = row.state as PrintJobState;
  if (state === 'PRINTING') {
    job.beginPrinting();
    return job;
  }
  if (state === 'DONE') {
    job.beginPrinting();
    job.complete(Instant.of(new Date(row.completed_at ?? row.attempted_at)));
    return job;
  }
  if (state === 'FAILED') {
    job.beginPrinting();
    job.fail(
      Instant.of(new Date(row.completed_at ?? row.attempted_at)),
      row.error ?? 'The print failed',
    );
    return job;
  }

  return job;
}
