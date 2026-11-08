/**
 * DummyPrinterAdapter — the training printer.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FAILURE IS A VALUE. AND NO PHYSICAL LAYOUT IS INVENTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story is explicit: *"The print adapter is the only component that
 * talks to the printer. In this build that is the Dummy Printer training
 * contract (`POST /api/tickets`); no real printer contract is invented
 * (BRD IR-16)."*
 *
 * **And the ticket's physical format is NOT invented here either** — the
 * prototype itself states that label content is invented, so Q-11 and
 * Q-12 remain open. So this adapter:
 *
 * - accepts a ticket and reports `PRINTED`;
 * - or fails with a **visible reason** — which is what the operator needs
 *   to know (BRD FR-19, B-7);
 * - and **asserts no layout at all**. It does not render a label, and it
 *   does not pretend to know what a label looks like.
 */
import type { Ticket } from '../../domain/entities/ticket.js';
import type { PrinterPort } from '../../domain/ports/ticket-ports.js';

export interface DummyPrinterOptions {
  /**
   * Whether the printer is available.
   *
   * **The training control** — so a test can make the printer fail on
   * purpose, and prove that the weighing is unaffected.
   */
  readonly available?: boolean;
  /** The reason reported when the printer is unavailable. */
  readonly unavailableReason?: string;
}

export class DummyPrinterAdapter implements PrinterPort {
  private available: boolean;
  private unavailableReason: string;

  /** The tickets this printer has accepted — the training record. */
  readonly printed: Ticket[] = [];

  constructor(options: DummyPrinterOptions = {}) {
    this.available = options.available ?? true;
    this.unavailableReason =
      options.unavailableReason ?? 'The printer is unavailable';
  }

  /** Make the printer available or unavailable. */
  setAvailable(available: boolean, reason?: string): void {
    this.available = available;
    if (reason !== undefined) {
      this.unavailableReason = reason;
    }
  }

  /**
   * Print the ticket.
   *
   * **The failure is a VALUE** — not a thrown error. The printer being out
   * of paper is a normal outcome of a legitimate request, and the operator
   * needs the reason to act on it (BRD FR-19).
   */
  async print(ticket: Ticket): Promise<
    | { readonly kind: 'PRINTED' }
    | { readonly kind: 'FAILED'; readonly reason: string }
  > {
    if (!this.available) {
      return { kind: 'FAILED', reason: this.unavailableReason };
    }

    this.printed.push(ticket);
    return { kind: 'PRINTED' };
  }
}
