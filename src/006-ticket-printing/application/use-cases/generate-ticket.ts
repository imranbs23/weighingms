/**
 * GenerateTicket — the batch's ticket.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TICKET PER SESSION. AND THE LINES CARRY THE RECORDS' OWN VALUES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The generation is **idempotent**: the guard is a `UNIQUE` constraint on
 * the session id, and a duplicate **returns the existing ticket** — with a
 * `200`, not a `409`. A retry after an ambiguous response must succeed,
 * because the caller cannot tell whether the first attempt reached the
 * server (ADR-042).
 *
 * AND ONLY THE CONFIRMED RECORDS ARE LINES
 * -----------------------------------------
 * *"A component was abandoned and re-weighed → Only the confirmed weighing
 * record appears as a ticket line; the abandoned attempt appears nowhere
 * on the ticket."*
 *
 * And the write-back's state is **irrelevant** here: *"The ticket is
 * generated for a session with a failed OrgaTEX write-back → the ticket is
 * still generated from the local confirmed records."*
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeighingRecord } from '../../../003-weighing-station/domain/entities/weighing-record.js';
import {
  Ticket,
  toleranceOutcome,
  type TicketBatchIdentity,
  type TicketLine,
} from '../../domain/entities/ticket.js';
import type {
  BatchIdentityPort,
  TicketConfigurationPort,
  TicketRepository,
} from '../../domain/ports/ticket-ports.js';

/**
 * The confirmed records, read from unit 003.
 *
 * **The station's own port over unit 003's repository** — so there is one
 * copy of each quantity, and the ticket's values are identical to the
 * recorded weighings by construction (NFR-2, BRD NFR-16).
 */
export interface ConfirmedRecordsPort {
  /** The session's confirmed records, in recipe order. */
  confirmedFor(sessionId: string): Promise<readonly WeighingRecord[]>;
}

export type GenerateTicketOutcome =
  | {
      readonly kind: 'GENERATED';
      readonly ticket: Ticket;
      /** `false` when the ticket already existed — the idempotent retry. */
      readonly isNew: boolean;
    }
  | {
      /** The batch is not complete. */
      readonly kind: 'NOT_COMPLETE';
      readonly message: string;
    }
  | {
      /** The MES has not given the batch's identity. */
      readonly kind: 'NO_BATCH_IDENTITY';
      readonly message: string;
    };

export interface GenerateTicketOptions {
  /** The session — the batch's own live state. */
  readonly sessions: {
    current(): Promise<{
      readonly sessionId: string;
      readonly batchId: { readonly value: string };
      readonly state: string;
      readonly operatorId: { readonly value: string };
      readonly completedCount: number;
      readonly componentCount: number;
    } | null>;
  };
  /** The confirmed records. */
  readonly records: ConfirmedRecordsPort;
  /** Where the ticket is stored. */
  readonly tickets: TicketRepository;
  /** The batch's identity — unit 001's. */
  readonly batchIdentity: BatchIdentityPort;
  /** The template and the language — the configuration's. */
  readonly configuration: TicketConfigurationPort;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class GenerateTicket {
  constructor(private readonly options: GenerateTicketOptions) {}

  /**
   * Generate the ticket for the current session's batch.
   */
  async execute(): Promise<GenerateTicketOutcome> {
    const session = await this.options.sessions.current();
    if (session === null) {
      return { kind: 'NOT_COMPLETE', message: 'There is no session' };
    }

    // ── THE BATCH MUST BE COMPLETE ──
    if (
      session.state !== 'COMPLETE' ||
      session.completedCount !== session.componentCount
    ) {
      return { kind: 'NOT_COMPLETE', message: 'The batch is not complete' };
    }

    // ── THE IDEMPOTENCY GUARD ──
    //
    // The constraint is the guarantee — a check-then-write is racy, and the
    // race admits two tickets for one batch. And a duplicate is NOT an
    // error: the existing ticket is returned.
    const existing = await this.options.tickets.findBySession(
      session.sessionId,
    );
    if (existing !== null) {
      return { kind: 'GENERATED', ticket: existing, isNew: false };
    }

    // ── THE BATCH'S IDENTITY ──
    //
    // The MES's facts — read, never computed.
    const identity = await this.options.batchIdentity.identity(
      session.batchId.value,
    );
    if (identity === null) {
      return {
        kind: 'NO_BATCH_IDENTITY',
        message: 'The batch’s identity is not known',
      };
    }

    // ── THE LINES ──
    //
    // ONLY the confirmed records. An abandoned attempt appears nowhere.
    //
    // And each line carries the record's **OWN** quantity strings — no
    // re-derivation, no re-formatting, and **no unit conversion** (ADR-042).
    const records = await this.options.records.confirmedFor(session.sessionId);

    const lines: TicketLine[] = records.map((record, index) => ({
      lineId: randomUUID(),
      sequence: index + 1,
      componentId: record.componentId.value,
      // The material's code — the record does not carry it, so it is the
      // **component's** own code, which is the recipe's slot identifier.
      // Unit `002`'s capture holds the material code for the trace; the
      // ticket's line identifies the component.
      materialCode: record.componentId.value,
      // The record's own strings.
      targetQuantity: record.targetAtWeighing.text,
      targetUnit: record.targetAtWeighing.unit,
      actualQuantity: record.actualQuantity.text,
      actualUnit: record.actualQuantity.unit,
      lotNumber: record.lotNumber,
      containerId: record.containerId,
      scaleId: record.scaleId.value,
      zoneAtConfirm: record.zoneAtConfirm,
      operatorId: record.operatorId.value,
      weighedAt: record.weighedAt,
    }));

    const ticket = new Ticket(
      randomUUID(),
      session.sessionId,
      identity,
      session.operatorId.value,
      Instant.of(this.options.clock()),
      // CAPTURED — so a later locale change does not alter this ticket.
      this.options.configuration.language(),
      // CAPTURED — so a reprint renders the same template version.
      this.options.configuration.templateId(),
      // Computed from the lines' zones — so an authorised override (whose
      // zone is `OVER`) makes the ticket say `OUT_OF_TOLERANCE`.
      toleranceOutcome(lines.map((line) => line.zoneAtConfirm)),
      lines,
    );

    try {
      await this.options.tickets.save(ticket);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // A concurrent generation won the race. Its ticket is the one
        // that counts — and the caller gets the SAME ticket, not an error.
        const winner = await this.options.tickets.findBySession(
          session.sessionId,
        );
        if (winner !== null) {
          return { kind: 'GENERATED', ticket: winner, isNew: false };
        }
        this.options.onError?.(
          `[ticket-printing] the ticket for ${session.sessionId} vanished between the write and the read`,
        );
      }
      throw error;
    }

    return { kind: 'GENERATED', ticket, isNew: true };
  }
}

/**
 * Is this error a UNIQUE constraint violation?
 *
 * `node:sqlite` surfaces a constraint failure as an Error whose message
 * contains the constraint name. The check is deliberately narrow — a
 * different error must be re-thrown, not swallowed (ADR-040's rule).
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') ||
    error.message.includes('SQLITE_CONSTRAINT_UNIQUE')
  );
}
