/**
 * The ticket and the print job — unit 006, bolt 019.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LINES CARRY THE RECORDS' OWN VALUES. AND THE PRINT PATH CANNOT
 * COST A WEIGHING.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../src/003-weighing-station/domain/entities/weighing-record.js';
import {
  Ticket,
  toleranceOutcome,
  type TicketLine,
} from '../../src/006-ticket-printing/domain/entities/ticket.js';
import { PrintJob } from '../../src/006-ticket-printing/domain/entities/print-job.js';

const AT = Instant.of(new Date('2026-11-06T10:15:00.000Z'));
const OPERATOR = OperatorId.create('OP-001');

function record(
  componentId = 'DYE-4471-Y',
  actual = '94.2400',
  unit = 'g',
  zone = 'OK',
): WeighingRecord {
  return new WeighingRecord(
    `WR-${componentId}`,
    'WS-1',
    ComponentId.create(componentId),
    WeightValue.of(actual, unit),
    WeightValue.of('94.0000', 'g'),
    null,
    zone as never,
    ScaleId.create('SCALE-A'),
    'PRECISION',
    '2026-0387',
    'C-12',
    OPERATOR,
    AT,
  );
}

function line(overrides: Partial<TicketLine> = {}): TicketLine {
  return {
    lineId: 'LINE-1',
    sequence: 1,
    componentId: 'DYE-4471-Y',
    materialCode: 'DYE-4471',
    targetQuantity: '94.0000',
    targetUnit: 'g',
    actualQuantity: '94.2400',
    actualUnit: 'g',
    lotNumber: '2026-0387',
    containerId: 'C-12',
    scaleId: 'SCALE-A',
    zoneAtConfirm: 'OK',
    operatorId: 'OP-001',
    weighedAt: AT,
    ...overrides,
  };
}

describe('the ticket', () => {
  it('carries the batch identity and the operator', () => {
    const ticket = new Ticket(
      'TKT-1',
      'WS-1',
      {
        batchId: 'B-24187',
        orderRef: 'SO-9931',
        machineRef: 'JET-04',
        shadeCode: 'Teal 4C',
      },
      'OP-001',
      AT,
      'en',
      'DEFAULT',
      'WITHIN_TOLERANCE',
      [line()],
    );

    expect(ticket.batch.batchId).toBe('B-24187');
    expect(ticket.batch.orderRef).toBe('SO-9931');
    expect(ticket.batch.machineRef).toBe('JET-04');
    expect(ticket.batch.shadeCode).toBe('Teal 4C');
    expect(ticket.operatorId).toBe('OP-001');
    expect(ticket.generatedAt.toDate().getTime()).toBe(AT.toDate().getTime());
  });

  it('CAPTURES the template, the language and the moment', () => {
    const ticket = new Ticket(
      'TKT-1',
      'WS-1',
      {
        batchId: 'B-24187',
        orderRef: 'SO-9931',
        machineRef: 'JET-04',
        shadeCode: 'Teal 4C',
      },
      'OP-001',
      AT,
      'ar',
      'TEMPLATE-V2',
      'WITHIN_TOLERANCE',
      [line()],
    );

    // A later template or locale change must not alter this ticket — so
    // the values are RECORDED.
    expect(ticket.templateId).toBe('TEMPLATE-V2');
    expect(ticket.language).toBe('ar');
  });

  it('each line keeps its OWN unit — no conversion at render time', () => {
    const ticket = new Ticket(
      'TKT-1',
      'WS-1',
      {
        batchId: 'B-24187',
        orderRef: 'SO-9931',
        machineRef: 'JET-04',
        shadeCode: 'Teal 4C',
      },
      'OP-001',
      AT,
      'en',
      'DEFAULT',
      'WITHIN_TOLERANCE',
      [
        line({ sequence: 1, actualQuantity: '94.2400', actualUnit: 'g' }),
        line({
          sequence: 2,
          componentId: 'AUX-0101',
          actualQuantity: '24.0100',
          actualUnit: 'kg',
        }),
      ],
    );

    // The grams stay grams and the kilograms stay kilograms — a line is a
    // reproduction of one weighing, and converting it would make the
    // ticket disagree with the record.
    expect(ticket.lines[0]?.actualUnit).toBe('g');
    expect(ticket.lines[1]?.actualUnit).toBe('kg');
    expect(ticket.lines[1]?.actualQuantity).toBe('24.0100');
  });

  it('the quantities are the RECORD’s OWN strings', () => {
    const weighed = record('DYE-4471-Y', '94.2400', 'g');
    const ticket = new Ticket(
      'TKT-1',
      'WS-1',
      {
        batchId: 'B-24187',
        orderRef: 'SO-9931',
        machineRef: 'JET-04',
        shadeCode: 'Teal 4C',
      },
      'OP-001',
      AT,
      'en',
      'DEFAULT',
      'WITHIN_TOLERANCE',
      [
        line({
          actualQuantity: weighed.actualQuantity.text,
          actualUnit: weighed.actualQuantity.unit,
          targetQuantity: weighed.targetAtWeighing.text,
          targetUnit: weighed.targetAtWeighing.unit,
        }),
      ],
    );

    // IDENTICAL — not re-derived, not re-formatted.
    expect(ticket.lines[0]?.actualQuantity).toBe(
      weighed.actualQuantity.text,
    );
    expect(ticket.lines[0]?.targetQuantity).toBe(
      weighed.targetAtWeighing.text,
    );
  });
});

describe('the tolerance outcome', () => {
  it('is WITHIN_TOLERANCE only when EVERY zone is OK', () => {
    expect(toleranceOutcome(['OK', 'OK', 'OK'])).toBe('WITHIN_TOLERANCE');
  });

  it('an OVER line — an authorised override — makes it OUT_OF_TOLERANCE', () => {
    expect(toleranceOutcome(['OK', 'OVER'])).toBe('OUT_OF_TOLERANCE');
    expect(toleranceOutcome(['NEAR'])).toBe('OUT_OF_TOLERANCE');
    expect(toleranceOutcome(['UNDER'])).toBe('OUT_OF_TOLERANCE');
  });

  it('is OUT_OF_TOLERANCE for an empty ticket', () => {
    expect(toleranceOutcome([])).toBe('OUT_OF_TOLERANCE');
  });
});

describe('the print job', () => {
  it('starts QUEUED', () => {
    const job = new PrintJob('JOB-1', 'TKT-1', AT, false);
    expect(job.state).toBe('QUEUED');
    expect(job.completedAt).toBeNull();
    expect(job.error).toBeNull();
  });

  it('moves forward only — QUEUED → PRINTING → DONE', () => {
    const job = new PrintJob('JOB-1', 'TKT-1', AT, false);
    job.beginPrinting();
    expect(job.state).toBe('PRINTING');
    job.complete(AT);
    expect(job.state).toBe('DONE');
    expect(job.completedAt).not.toBeNull();
  });

  it('a settled job is TERMINAL', () => {
    const job = new PrintJob('JOB-1', 'TKT-1', AT, false);
    job.beginPrinting();
    job.complete(AT);

    expect(() => job.beginPrinting()).toThrow();
    expect(() => job.fail(AT, 'x')).toThrow();
  });

  it('a FAILED job carries a VISIBLE error', () => {
    const job = new PrintJob('JOB-1', 'TKT-1', AT, false);
    job.beginPrinting();
    job.fail(AT, 'The printer is out of paper');

    expect(job.state).toBe('FAILED');
    expect(job.error).toBe('The printer is out of paper');
    expect(job.completedAt).not.toBeNull();
  });

  it('isReprint comes from the REQUEST — never from the count', () => {
    // A double-tap produces two jobs, and the second is still a FIRST
    // print unless a reason was supplied (BRD FR-28).
    const first = new PrintJob('JOB-1', 'TKT-1', AT, false);
    const second = new PrintJob('JOB-2', 'TKT-1', AT, false);

    expect(first.isReprint).toBe(false);
    expect(second.isReprint).toBe(false);

    // And a job with a reason IS a reprint.
    const reprint = new PrintJob('JOB-3', 'TKT-1', AT, true);
    expect(reprint.isReprint).toBe(true);
  });

  it('the reprint_of field is reserved for story 003', () => {
    const job = new PrintJob('JOB-1', 'TKT-1', AT, true, 'JOB-0');
    expect(job.reprintOf).toBe('JOB-0');
  });
});
