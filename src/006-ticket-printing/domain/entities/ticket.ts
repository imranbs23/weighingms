/**
 * Ticket — the batch's weighing ticket.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A READ MODEL OVER THE IMMUTABLE WEIGHING RECORDS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The ticket reproduces a batch's confirmed weighings. It is **not** a
 * second copy of the truth — the records are the truth, and this is a
 * projection of them, rendered once and then frozen.
 *
 * AND THE QUANTITIES ARE THE RECORDS' OWN STRINGS
 * -------------------------------------------------
 * *"When any quantity on it is compared with the recorded weighing, Then
 * the value is identical" (NFR-2, BRD NFR-16).*
 *
 * So the lines carry the records' **own** quantity strings — not
 * re-derived, not re-formatted, and **not converted**. A line is a
 * reproduction of one weighing, so it keeps that weighing's unit. (A
 * *total* is a derived fact and gets a unit of its own — bolt `018`'s
 * summary. ADR-042.)
 *
 * AND THE TEMPLATE, THE LANGUAGE AND THE MOMENT ARE CAPTURED
 * -------------------------------------------------------------
 * *"Ticket.generatedAt, Ticket.language and Ticket.templateId are captured
 * at generation time so a later locale or template change does not alter
 * an existing ticket."*
 *
 * And the template's **content** is configuration's business — this bolt
 * records **which** template rendered the ticket, and invents no layout
 * (BRD IR-16, Q-11, Q-12).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';

/**
 * The batch's overall tolerance outcome.
 *
 * **Two values, never three.** A batch is either within tolerance or it
 * is not, and a single component out of tolerance makes it not.
 */
export type ToleranceOutcome = 'WITHIN_TOLERANCE' | 'OUT_OF_TOLERANCE';

/**
 * One confirmed component's line.
 *
 * **Every quantity is a string** — the record's own — and the unit is
 * **the record's own** (BRD NFR-16).
 */
export interface TicketLine {
  readonly lineId: string;
  /** The recipe's order. */
  readonly sequence: number;
  readonly componentId: string;
  readonly materialCode: string;
  /** The target — the record's own string. */
  readonly targetQuantity: string;
  readonly targetUnit: string;
  /** The actual — the record's own string. */
  readonly actualQuantity: string;
  readonly actualUnit: string;
  readonly lotNumber: string | null;
  readonly containerId: string | null;
  readonly scaleId: string;
  /** The zone at confirmation — `OVER` means an authorised override. */
  readonly zoneAtConfirm: string;
  readonly operatorId: string;
  readonly weighedAt: Instant;
}

/**
 * The batch's identity — carried onto the ticket from unit `001`.
 *
 * **The MES's facts** — the order reference, the machine reference and
 * the shade — and they are carried, not computed.
 */
export interface TicketBatchIdentity {
  readonly batchId: string;
  readonly orderRef: string;
  readonly machineRef: string;
  readonly shadeCode: string;
}

export class Ticket {
  constructor(
    readonly ticketId: string,
    /** The session it is for — **one ticket per session**. */
    readonly sessionId: string,
    readonly batch: TicketBatchIdentity,
    /** Who generated it. */
    readonly operatorId: string,
    /** When — **captured**. */
    readonly generatedAt: Instant,
    /** The language — **captured**. */
    readonly language: string,
    /** The template — **captured**, and its content is configuration's. */
    readonly templateId: string,
    /** The batch's overall outcome. */
    readonly toleranceOutcome: ToleranceOutcome,
    /** The lines, in recipe order. */
    readonly lines: readonly TicketLine[],
  ) {}

  /** How many lines the ticket carries. */
  get lineCount(): number {
    return this.lines.length;
  }
}

/**
 * The batch's tolerance outcome, from the lines' zones.
 *
 * **`WITHIN_TOLERANCE` only when EVERY line's zone is `OK`.**
 *
 * **And a line whose zone is `OVER` was confirmed under a supervisor
 * override** (bolt `016`) — so it was **not** within tolerance, and the
 * ticket says so. That is what makes the ticket a usable quality signal
 * (BRD FR-17, FR-11).
 *
 * And an **empty** ticket is `OUT_OF_TOLERANCE` — nothing has been shown
 * to be within tolerance.
 */
export function toleranceOutcome(
  zones: readonly string[],
): ToleranceOutcome {
  if (zones.length === 0) return 'OUT_OF_TOLERANCE';
  return zones.every((zone) => zone === 'OK')
    ? 'WITHIN_TOLERANCE'
    : 'OUT_OF_TOLERANCE';
}
