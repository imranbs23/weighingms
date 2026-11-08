/**
 * PrintJob — one print attempt.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATE MOVES FORWARD ONLY. AND `PRINTING` IS COMMITTED BEFORE THE
 * PRINTER IS CALLED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `QUEUED → PRINTING → DONE | FAILED`
 *
 * **And the transition to `PRINTING` is written and committed BEFORE the
 * printer is called** — because that is the only evidence that an attempt
 * was in flight. A crash that leaves a `QUEUED` job cannot be told apart
 * from one that never started, and a reconciler reading that would not
 * reprint (BRD NFR-05, NFR-3, ADR-042).
 *
 * AND THIS JOB NEVER TOUCHES THE WEIGHING RECORD
 * ----------------------------------------------
 * B-7: *"a printer failure must never cost a weighing."*
 *
 * The guarantee is **structural** — the print path has no
 * weighing-record repository, so there is no path from the printer's
 * failure to the record. Not "we do not roll it back": there is nothing
 * to roll back.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';

/** The job's lifecycle. A **closed set of four**. */
export type PrintJobState = 'QUEUED' | 'PRINTING' | 'DONE' | 'FAILED';

export const PRINT_JOB_STATES: readonly PrintJobState[] = [
  'QUEUED',
  'PRINTING',
  'DONE',
  'FAILED',
];

/** Is this a print job state? */
export function isPrintJobState(value: unknown): value is PrintJobState {
  return (
    typeof value === 'string' &&
    (PRINT_JOB_STATES as readonly string[]).includes(value)
  );
}

export class PrintJob {
  private currentState: PrintJobState;

  constructor(
    readonly jobId: string,
    /** The ticket it prints. */
    readonly ticketId: string,
    /** When the attempt started. */
    readonly attemptedAt: Instant,
    /**
     * Whether this is a **reprint**.
     *
     * **It is a property of the REQUEST, not of the count** — a double-tap
     * produces two jobs and the second is still a first print unless a
     * reprint reason was supplied (BRD FR-28).
     *
     * And it is `true` for a reprint **even when the ticket's only prior
     * print FAILED** — because it is not the first print *attempt* for
     * that ticket (ADR-043).
     */
    readonly isReprint: boolean,
    /** The original ticket, when this is a reprint. */
    readonly reprintOf: string | null = null,
    /**
     * The reason for the reprint — **verbatim**, never truncated.
     *
     * `null` for a first print, which has no reason.
     */
    readonly reason: string | null = null,
    /** Who asked for the print. */
    readonly actorId: string | null = null,
    /** Their role — **whoever pressed reprint**, which may be the operator. */
    readonly actorRole: string | null = null,
  ) {
    this.currentState = 'QUEUED';
  }

  /** The job's state. */
  get state(): PrintJobState {
    return this.currentState;
  }

  /** When the job settled — `null` while it is in flight. */
  get completedAt(): Instant | null {
    return this.settledAt;
  }

  /** The error, on failure. */
  get error(): string | null {
    return this.failureReason;
  }

  private settledAt: Instant | null = null;
  private failureReason: string | null = null;

  /**
   * The job is being printed.
   *
   * **Committed before the printer is called** — the order that makes a
   * crash reconcilable (ADR-042).
   */
  beginPrinting(): void {
    this.assertState('QUEUED');
    this.currentState = 'PRINTING';
  }

  /**
   * The printer accepted the ticket.
   */
  complete(at: Instant): void {
    this.assertState('PRINTING');
    this.currentState = 'DONE';
    this.settledAt = at;
  }

  /**
   * The printer failed, or was unavailable.
   *
   * **The error is stored and is visible** — the operator needs to know
   * *why* the paper did not come out (BRD FR-19).
   */
  fail(at: Instant, reason: string): void {
    this.assertState('PRINTING');
    this.currentState = 'FAILED';
    this.settledAt = at;
    this.failureReason = reason;
  }

  /**
   * The state moves FORWARD ONLY.
   *
   * A job that has settled is **terminal** — and the database refuses to
   * update it (BRD DR-02).
   */
  private assertState(expected: PrintJobState): void {
    if (this.currentState !== expected) {
      throw new Error(
        `The print job is ${this.currentState}, and cannot move to ${expected}`,
      );
    }
  }
}
