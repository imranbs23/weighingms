/**
 * The ticket and print-job repositories.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. AND THE QUANTITIES ARE THE RECORDS' OWN STRINGS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The ticket's rows carry the **exact** quantity strings the weighing
 * records carried — so the ticket's quantities are identical to the
 * recorded weighings by construction, not by discipline (NFR-2, BRD
 * NFR-16, ADR-042).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  Ticket,
  type TicketBatchIdentity,
  type TicketLine,
} from '../../domain/entities/ticket.js';
import type { TicketRepository } from '../../domain/ports/ticket-ports.js';
import type { SqliteDatabase } from './ticket-database.js';

interface TicketRow {
  ticket_id: string;
  session_id: string;
  batch_id: string;
  order_ref: string;
  machine_ref: string;
  shade_code: string;
  operator_id: string;
  generated_at: string;
  language: string;
  template_id: string;
  tolerance_outcome: string;
  line_count: number;
  recorded_at: string;
}

interface LineRow {
  line_id: string;
  ticket_id: string;
  sequence: number;
  component_id: string;
  material_code: string;
  target_quantity: string;
  target_unit: string;
  actual_quantity: string;
  actual_unit: string;
  lot_number: string | null;
  container_id: string | null;
  scale_id: string;
  zone_at_confirm: string;
  operator_id: string;
  weighed_at: string;
}

export class SqliteTicketRepository implements TicketRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Save the ticket and its lines.
   *
   * **INSERT ONLY.** And the `UNIQUE` on `session_id` is the idempotency
   * guard — the caller catches its violation and returns the existing
   * ticket (ADR-042).
   */
  async save(ticket: Ticket): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO tickets
           (ticket_id, session_id, batch_id, order_ref, machine_ref,
            shade_code, operator_id, generated_at, language, template_id,
            tolerance_outcome, line_count, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ticket.ticketId,
        ticket.sessionId,
        ticket.batch.batchId,
        ticket.batch.orderRef,
        ticket.batch.machineRef,
        ticket.batch.shadeCode,
        ticket.operatorId,
        ticket.generatedAt.toString(),
        ticket.language,
        ticket.templateId,
        ticket.toleranceOutcome,
        ticket.lineCount,
        this.clock().toISOString(),
      );

    const insertLine = this.db.prepare(
      `INSERT INTO ticket_lines
         (line_id, ticket_id, sequence, component_id, material_code,
          target_quantity, target_unit, actual_quantity, actual_unit,
          lot_number, container_id, scale_id, zone_at_confirm, operator_id,
          weighed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const line of ticket.lines) {
      insertLine.run(
        line.lineId,
        ticket.ticketId,
        line.sequence,
        line.componentId,
        line.materialCode,
        // The record's OWN strings — not re-derived, not re-formatted, and
        // NOT converted.
        line.targetQuantity,
        line.targetUnit,
        line.actualQuantity,
        line.actualUnit,
        line.lotNumber,
        line.containerId,
        line.scaleId,
        line.zoneAtConfirm,
        line.operatorId,
        line.weighedAt.toString(),
      );
    }
  }

  /** The ticket for a session — `null` when there is none. */
  async findBySession(sessionId: string): Promise<Ticket | null> {
    const row = this.db
      .prepare('SELECT * FROM tickets WHERE session_id = ? LIMIT 1')
      .get(sessionId) as unknown as TicketRow | undefined;
    return row === undefined ? null : this.toTicket(row);
  }

  /** The ticket by its id — `null` when there is none. */
  async findById(ticketId: string): Promise<Ticket | null> {
    const row = this.db
      .prepare('SELECT * FROM tickets WHERE ticket_id = ? LIMIT 1')
      .get(ticketId) as unknown as TicketRow | undefined;
    return row === undefined ? null : this.toTicket(row);
  }

  private toTicket(row: TicketRow): Ticket {
    const lines = (
      this.db
        .prepare(
          'SELECT * FROM ticket_lines WHERE ticket_id = ? ORDER BY sequence ASC',
        )
        .all(row.ticket_id) as unknown as LineRow[]
    ).map((line): TicketLine => ({
      lineId: line.line_id,
      sequence: line.sequence,
      componentId: line.component_id,
      materialCode: line.material_code,
      targetQuantity: line.target_quantity,
      targetUnit: line.target_unit,
      actualQuantity: line.actual_quantity,
      actualUnit: line.actual_unit,
      lotNumber: line.lot_number,
      containerId: line.container_id,
      scaleId: line.scale_id,
      zoneAtConfirm: line.zone_at_confirm,
      operatorId: line.operator_id,
      weighedAt: Instant.of(new Date(line.weighed_at)),
    }));

    const identity: TicketBatchIdentity = {
      batchId: row.batch_id,
      orderRef: row.order_ref,
      machineRef: row.machine_ref,
      shadeCode: row.shade_code,
    };

    return new Ticket(
      row.ticket_id,
      row.session_id,
      identity,
      row.operator_id,
      Instant.of(new Date(row.generated_at)),
      row.language,
      row.template_id,
      row.tolerance_outcome === 'WITHIN_TOLERANCE'
        ? 'WITHIN_TOLERANCE'
        : 'OUT_OF_TOLERANCE',
      lines,
    );
  }
}
