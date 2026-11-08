/**
 * The ports of bolt 019.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO WEIGHING-RECORD REPOSITORY HERE. AND THAT IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * B-7: *"a printer failure must never cost a weighing."*
 *
 * The print path reads the ticket, writes the print job, and calls the
 * printer. It has **no** weighing-record repository — so there is no path
 * from the printer's failure to the record. Not "we do not roll it back":
 * there is nothing to roll back (ADR-042).
 *
 * AND THE RECORDS ARE READ THROUGH UNIT 003's OWN REPOSITORY
 * -----------------------------------------------------------
 * The **generation** reads them — it is a read model over them. And it
 * reads them through the same repository the rest of the product uses,
 * so "the ticket's quantities are identical to the recorded weighing" is
 * guaranteed by there being **one** copy of each quantity.
 */
import type { Ticket, TicketBatchIdentity } from '../entities/ticket.js';
import type { PrintJob } from '../entities/print-job.js';

/**
 * The ticket's store.
 *
 * **Append-only**, and **one ticket per session** — enforced by a
 * `UNIQUE` constraint, not by a check (ADR-042).
 */
export interface TicketRepository {
  /** Save the ticket. A duplicate session is refused by the constraint. */
  save(ticket: Ticket): Promise<void>;

  /** The ticket for a session — `null` when there is none. */
  findBySession(sessionId: string): Promise<Ticket | null>;

  /** The ticket by its id — `null` when there is none. */
  findById(ticketId: string): Promise<Ticket | null>;
}

/**
 * The print job's store.
 *
 * **Append-only in practice** — each attempt is a new row, and a settled
 * job may not be edited.
 */
export interface PrintJobRepository {
  /** Save the job, or its transition. */
  save(job: PrintJob): Promise<void>;

  /** The job by its id — `null` when there is none. */
  findById(jobId: string): Promise<PrintJob | null>;
}

/**
 * The printer.
 *
 * **A failure is a VALUE, not a thrown error** — the printer being out of
 * paper is a normal outcome of a legitimate request, and the operator
 * needs the reason (BRD FR-19).
 */
export interface PrinterPort {
  /**
   * Print the ticket.
   *
   * @returns `PRINTED`, or `FAILED` with the reason the operator will
   *   read.
   */
  print(ticket: Ticket): Promise<
    | { readonly kind: 'PRINTED' }
    | { readonly kind: 'FAILED'; readonly reason: string }
  >;
}

/**
 * The batch's identity — unit `001`'s fact.
 *
 * **Read, never computed.** The order reference, the machine reference
 * and the shade are the MES's.
 */
export interface BatchIdentityPort {
  /** The batch's identity — `null` when the MES has not said. */
  identity(batchId: string): Promise<TicketBatchIdentity | null>;
}

/**
 * The configuration — the template and the language.
 *
 * **Story `005`'s business**, but the port is declared here so this bolt
 * can read them. The template's **content** is configuration's; this
 * bolt records **which** template (BRD IR-16, Q-11, Q-12).
 */
export interface TicketConfigurationPort {
  /** The template id to render with — **captured** on the ticket. */
  templateId(): string;

  /** The language to render in — **captured** on the ticket. */
  language(): string;
}
