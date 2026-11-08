/**
 * PrintTicket — drive the job through its lifecycle, and call the printer.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ORDER IS THE DESIGN: `PRINTING` IS COMMITTED BEFORE THE PRINTER
 * IS CALLED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ```text
 * 1. create the job in QUEUED     ← committed
 * 2. move it to PRINTING           ← committed
 * 3. call the printer
 * 4. move it to DONE or FAILED     ← committed
 * ```
 *
 * **A crash between 2 and 3 leaves a `PRINTING` job** — which is
 * *reconcilable*, because it is a record that the attempt was in flight.
 * A crash that left a `QUEUED` job could not be told apart from one that
 * never started (BRD NFR-05, NFR-3, ADR-042).
 *
 * AND THIS USE CASE HAS NO WEIGHING-RECORD REPOSITORY
 * ----------------------------------------------------
 * B-7: *"a printer failure must never cost a weighing."*
 *
 * The guarantee is **structural**: this use case reads the ticket, writes
 * the print job, and calls the printer. It has **no** way to reach the
 * weighing record — so a printer failure cannot roll it back, suppress it
 * or hide it. There is nothing to roll back.
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { PrintJob } from '../../domain/entities/print-job.js';
import type { Ticket } from '../../domain/entities/ticket.js';
import type {
  PrintJobRepository,
  PrinterPort,
  TicketRepository,
} from '../../domain/ports/ticket-ports.js';

export type PrintTicketOutcome =
  | {
      readonly kind: 'PRINTED';
      readonly job: PrintJob;
    }
  | {
      /**
       * The print FAILED.
       *
       * **And the job exists, with the error visible** — the operator
       * needs to know *why* the paper did not come out, and they need the
       * job to reprint (BRD FR-19, B-7).
       */
      readonly kind: 'FAILED';
      readonly job: PrintJob;
    }
  | {
      /** There is no such ticket. */
      readonly kind: 'NOT_FOUND';
      readonly message: string;
    };

export interface PrintTicketOptions {
  /** Where the ticket is stored. */
  readonly tickets: TicketRepository;
  /** Where the job is stored. */
  readonly jobs: PrintJobRepository;
  /** The printer — the only component that talks to it. */
  readonly printer: PrinterPort;
  /** The clock. */
  readonly clock: () => Date;
  /**
   * The reprint reason.
   *
   * **`null` means a FIRST PRINT** — and the marking is a property of the
   * *request*, not of the count of prior jobs (BRD FR-28). A double-tap
   * produces two jobs and the second is still a first print.
   *
   * The reason itself is story `003`'s business, so this bolt has no way
   * to supply one.
   */
  readonly reprintReason?: string | null;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

/**
 * The marking of a print.
 *
 * **Everything here is DERIVED** — the reason's presence, the ticket id in
 * the path, and the session's actor (ADR-043). A client supplies **none**
 * of it.
 */
export interface PrintMarking {
  /** The reason — and its presence is what makes this a reprint. */
  readonly reason: string | null;
  /** Who asked for the print. */
  readonly actorId: string;
  /** Their role. */
  readonly actorRole: string;
  /** Whether this is a reprint. */
  readonly isReprint: boolean;
  /** The original ticket, when this is a reprint. */
  readonly reprintOf: string | null;
}

export class PrintTicket {
  constructor(private readonly options: PrintTicketOptions) {}

  /**
   * Print the ticket.
   *
   * @param ticketId The ticket to print.
   * @param marking The print's marking — **derived** by the caller, never
   *   supplied by a client (ADR-043).
   */
  async execute(
    ticketId: string,
    marking?: PrintMarking,
  ): Promise<PrintTicketOutcome> {
    const ticket = await this.options.tickets.findById(ticketId);
    if (ticket === null) {
      return { kind: 'NOT_FOUND', message: 'There is no such ticket' };
    }

    // ── 1. THE JOB, IN `QUEUED` ──
    //
    // The marking is set AT CREATION — never edited. And `isReprint` comes
    // from the reason's presence, so it is true for a reprint and false
    // for a first print however many jobs precede it.
    const isReprint = marking?.isReprint ?? false;
    const reason = marking?.reason ?? null;

    const job = new PrintJob(
      randomUUID(),
      ticket.ticketId,
      Instant.of(this.options.clock()),
      isReprint,
      marking?.reprintOf ?? null,
      reason,
      marking?.actorId ?? null,
      marking?.actorRole ?? null,
    );
    await this.options.jobs.save(job);

    // ── 2. `PRINTING`, COMMITTED BEFORE THE PRINTER IS CALLED ──
    job.beginPrinting();
    await this.options.jobs.save(job);

    // ── 3. THE PRINTER ──
    //
    // And the failure is a VALUE — the printer being out of paper is a
    // normal outcome, and the operator needs the reason.
    const result = await this.options.printer.print(ticket);

    // ── 4. THE JOB SETTLES ──
    if (result.kind === 'PRINTED') {
      job.complete(Instant.of(this.options.clock()));
      await this.options.jobs.save(job);
      return { kind: 'PRINTED', job };
    }

    job.fail(Instant.of(this.options.clock()), result.reason);
    await this.options.jobs.save(job);

    this.options.onError?.(
      `[ticket-printing] the print of ticket ${ticket.ticketId} failed: ${result.reason}`,
    );

    // AND THE WEIGHING IS UNAFFECTED — there is no path from here to the
    // record. The ticket is offered for reprint.
    return { kind: 'FAILED', job };
  }
}
