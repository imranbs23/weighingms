/**
 * ReprintTicket — the marked reprint, and the audit entry.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MARKING IS DERIVED. THE REASON IS MANDATORY. AND THE AUDIT ENTRY
 * IS WRITTEN WHETHER THE PRINT SUCCEEDED OR FAILED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The order:
 *
 * 1. **The operator session must be present** — attribution.
 * 2. **The reason must be non-empty** — refused **before** anything is
 *    written, so no print job exists for a reprint with no justification.
 * 3. **The ticket must exist** — the thing being reprinted.
 * 4. **The print job is created WITH the marking** — `isReprint`,
 *    `reprintOf`, the reason, the actor and the role.
 * 5. **The printer is called** — bolt `019`'s order, unchanged.
 * 6. **The audit entry is written** — the privileged action.
 *
 * **And step 6 happens whether the print SUCCEEDED or FAILED.** The
 * privileged action is the **request**, not the paper's arrival — and a
 * requested second copy that did not arrive is the case an auditor most
 * needs to see (ADR-043).
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  AuditAction,
  AuditEntry,
  AuditSubject,
} from '../../domain/entities/audit-entry.js';
import type { AuditEntryRepository } from '../../domain/ports/audit-entry-repository.js';
import type { PrintJobRepository, TicketRepository } from '../../domain/ports/ticket-ports.js';
import type { PrintTicket } from './print-ticket.js';

export type ReprintTicketOutcome =
  | {
      readonly kind: 'REPRINTED';
      readonly jobId: string;
      readonly jobState: string;
      /** The audit entry — the privileged action. */
      readonly auditEntry: AuditEntry;
    }
  | {
      /**
       * The reason is absent or empty.
       *
       * **And no print job was created** — the request is refused at the
       * boundary, not recorded as a blank justification.
       */
      readonly kind: 'REASON_REQUIRED';
      readonly message: string;
    }
  | {
      /** There is no such ticket. */
      readonly kind: 'NOT_FOUND';
      readonly message: string;
    };

export interface ReprintTicketOptions {
  /** Where the ticket is stored. */
  readonly tickets: TicketRepository;
  /** Where the job is stored. */
  readonly jobs: PrintJobRepository;
  /** The trail. */
  readonly audit: AuditEntryRepository;
  /** The print — bolt 019's use case, unchanged. */
  readonly print: PrintTicket;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class ReprintTicket {
  constructor(private readonly options: ReprintTicketOptions) {}

  /**
   * Reprint the ticket.
   *
   * @param ticketId The ticket to reprint — and the `reprintOf` link.
   * @param reason The reason — **mandatory**.
   * @param actorId Who asked for it.
   * @param actorRole Their role — **whoever pressed reprint**, which may be
   *   the operator. A reprint is privileged but does **not** require
   *   supervisor authentication in this build (BRD FR-35).
   */
  async execute(
    ticketId: string,
    reason: string,
    actorId: string,
    actorRole: string,
  ): Promise<ReprintTicketOutcome> {
    // ── THE REASON. REFUSED BEFORE ANY WRITE. ──
    //
    // The reason is what makes the marking true AND what justifies the
    // privileged action — so an absent one is refused at the boundary,
    // and no print job is created.
    if (reason.trim().length === 0) {
      this.options.onError?.(
        '[ticket-printing] a reprint was refused — it carried no reason',
      );
      return {
        kind: 'REASON_REQUIRED',
        message: 'A reprint must carry a reason',
      };
    }

    // ── THE TICKET ──
    const ticket = await this.options.tickets.findById(ticketId);
    if (ticket === null) {
      return { kind: 'NOT_FOUND', message: 'There is no such ticket' };
    }

    // ── THE PRINT JOB, WITH THE MARKING ──
    //
    // The marking is DERIVED: `isReprint` from the reason's presence,
    // `reprintOf` from the ticket id, the actor and the role from the
    // session. **No client supplied any of them** (ADR-043).
    const outcome = await this.options.print.execute(ticketId, {
      reason,
      actorId,
      actorRole,
      isReprint: true,
      reprintOf: ticketId,
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { kind: 'NOT_FOUND', message: 'There is no such ticket' };
    }

    const job = outcome.job;

    // ── THE AUDIT ENTRY ──
    //
    // Written **whether the print succeeded or failed** — the privileged
    // action is the REQUEST, and the request happened (ADR-043).
    const entry = new AuditEntry({
      entryId: randomUUID(),
      action: AuditAction.of('REPRINT'),
      actorId,
      actorRole,
      // The subject: the ticket AND the original print job.
      subject: AuditSubject.create(
        `ticket=${ticket.ticketId};job=${job.jobId}`,
      ),
      // The reason, VERBATIM. Never truncated.
      reason,
      occurredAt: Instant.of(this.options.clock()),
    });

    await this.options.audit.record(entry);

    return {
      kind: 'REPRINTED',
      jobId: job.jobId,
      jobState: job.state,
      auditEntry: entry,
    };
  }
}
