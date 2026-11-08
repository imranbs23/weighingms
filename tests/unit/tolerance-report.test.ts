/**
 * The tolerance report — unit 006, bolt 023.
 *
 * ══════════════════════════════════════════════════════════════════════
 * IT READS THE RECORDED ZONE, AND IT MUTATES NOTHING.
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
  AuditAction,
  AuditEntry,
  AuditSubject,
} from '../../src/006-ticket-printing/domain/entities/audit-entry.js';
import {
  BuildToleranceReport,
  type BatchProgressPort,
  type ReportAuditPort,
  type ReportRecordsPort,
  type ShiftPatternPort,
} from '../../src/006-ticket-printing/application/use-cases/build-tolerance-report.js';

const AT = Instant.of(new Date('2026-11-06T10:00:00.000Z'));
const PERIOD = {
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-30T23:59:59.000Z'),
};

function record(
  componentId = 'DYE-4471-Y',
  zone = 'OK',
  actual = '94.2400',
): WeighingRecord {
  return new WeighingRecord(
    `WR-${componentId}`,
    'WS-1',
    ComponentId.create(componentId),
    WeightValue.of(actual, 'g'),
    WeightValue.of('94.0000', 'g'),
    null,
    zone as never,
    ScaleId.create('SCALE-A'),
    'PRECISION',
    '2026-0387',
    'C-12',
    OperatorId.create('OP-001'),
    AT,
  );
}

function overrideEntry(
  entryId: string,
  subject: string,
  actorId = 'OP-SUP-001',
  action = 'TOLERANCE_OVERRIDE',
): AuditEntry {
  return new AuditEntry({
    entryId,
    action: AuditAction.of(action as 'TOLERANCE_OVERRIDE'),
    actorId,
    actorRole: 'SUPERVISOR',
    subject: AuditSubject.create(subject),
    reason: 'the client accepted the excess',
    occurredAt: AT,
  });
}

/** A report over a fixed set of records and entries. */
function build(
  records: readonly WeighingRecord[],
  entries: readonly AuditEntry[],
  progress: BatchProgressPort['progressFor'] extends (
    period: infer P,
  ) => Promise<infer R>
    ? (period: P) => Promise<R>
    : never = async () => [],
): BuildToleranceReport {
  const recordsPort: ReportRecordsPort = {
    between: async () => records,
  };
  const auditPort: ReportAuditPort = {
    filter: async (filter) =>
      entries.filter((entry) => {
        if (
          filter.action !== undefined &&
          filter.action !== null &&
          entry.action.value !== filter.action
        ) {
          return false;
        }
        return true;
      }),
  };
  const shifts: ShiftPatternPort = {
    resolve: async (name) =>
      name === 'DAY'
        ? { from: PERIOD.from, to: PERIOD.to }
        : null,
    names: () => ['DAY'],
  };

  return new BuildToleranceReport({
    records: recordsPort,
    audit: auditPort,
    progress: { progressFor: progress },
    shifts,
  });
}

describe('the tolerance report', () => {
  it('a weighing whose recorded zone was not OK is a FAILURE', async () => {
    const report = await build(
      [record('DYE-4471-Y', 'OK'), record('DYE-4471-B', 'OVER')],
      [],
    ).execute(PERIOD);

    expect(report.failureCount).toBe(1);
    expect(report.failures[0]?.componentId).toBe('DYE-4471-B');
    expect(report.failures[0]?.zone).toBe('OVER');
  });

  it('a weighing whose recorded zone was OK is NOT a failure', async () => {
    const report = await build([record('DYE-4471-Y', 'OK')], []).execute(
      PERIOD,
    );

    expect(report.failureCount).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('the zone is READ from the record — never recomputed', async () => {
    // A record whose zone is OVER, with a target that would be within
    // tolerance if the tolerance were recomputed. The report says OVER —
    // because the RECORD says OVER.
    const failed = record('DYE-4471-Y', 'OVER', '94.2400');
    const report = await build([failed], []).execute(PERIOD);

    expect(report.failureCount).toBe(1);
    expect(report.failures[0]?.zone).toBe('OVER');
  });

  it('an override row JOINS the entry to the weighing', async () => {
    const report = await build(
      [record('DYE-4471-Y', 'OVER', '120.0000')],
      [
        overrideEntry(
          'E1',
          'session=WS-1;component=DYE-4471-Y',
        ),
      ],
    ).execute(PERIOD);

    expect(report.overrideCount).toBe(1);
    const row = report.overrides[0];
    // The actor, the role and the reason — from the ENTRY.
    expect(row?.actorId).toBe('OP-SUP-001');
    expect(row?.actorRole).toBe('SUPERVISOR');
    expect(row?.reason).toBe('the client accepted the excess');
    // And the subject — from the WEIGHING.
    expect(row?.componentId).toBe('DYE-4471-Y');
    expect(row?.actualQuantity).toBe('120.0000');
  });

  it('TWO overrides on one subject are TWO rows', async () => {
    const report = await build(
      [record('DYE-4471-Y', 'OVER')],
      [
        overrideEntry('E1', 'session=WS-1;component=DYE-4471-Y', 'OP-SUP-001'),
        overrideEntry('E2', 'session=WS-1;component=DYE-4471-Y', 'OP-SUP-002'),
      ],
    ).execute(PERIOD);

    expect(report.overrideCount).toBe(2);
    expect(report.overrides[0]?.actorId).toBe('OP-SUP-001');
    expect(report.overrides[1]?.actorId).toBe('OP-SUP-002');
  });

  it('a REPRINT entry is not an override', async () => {
    const report = await build(
      [],
      [overrideEntry('E1', 'session=WS-1;component=DYE-4471-Y', 'OP-SUP-001', 'REPRINT')],
    ).execute(PERIOD);

    // The report reads the TOLERANCE_OVERRIDE action only — a reprint is
    // not an override, and a print failure is not a tolerance failure.
    expect(report.overrideCount).toBe(0);
  });

  it('a ZERO period is a VALID report — zero counts and no error', async () => {
    const report = await build([], []).execute(PERIOD);

    expect(report.failureCount).toBe(0);
    expect(report.overrideCount).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.overrides).toEqual([]);
  });

  it('a zero period still reports the PROGRESS', async () => {
    const report = await build([], [], async () => [
      { batchId: 'B-24187', weighed: 2, total: 5, state: 'WEIGHING' },
    ]).execute(PERIOD);

    expect(report.failureCount).toBe(0);
    expect(report.progress).toHaveLength(1);
    expect(report.progress[0]?.batchId).toBe('B-24187');
  });

  it('the report MUTATES NOTHING — and the trail is not written to', async () => {
    let recorded = 0;
    const auditPort: ReportAuditPort = {
      filter: async () => [],
    };
    const entries: AuditEntry[] = [];
    const trail = {
      record: async (entry: AuditEntry) => {
        recorded += 1;
        entries.push(entry);
      },
      filter: auditPort.filter,
    };

    const report = await new BuildToleranceReport({
      records: { between: async () => [record()] },
      audit: trail,
      progress: { progressFor: async () => [] },
      shifts: { resolve: async () => null, names: () => [] },
    }).execute(PERIOD);

    expect(report.failureCount).toBe(0);
    // NO "report generated" entry — the report is not a privileged action.
    expect(recorded).toBe(0);
    expect(entries).toHaveLength(0);
  });

  it('a named SHIFT resolves to a range — one query, two ways', async () => {
    const report = await build([record('DYE-4471-Y', 'OVER')], []).executeForShift(
      'DAY',
    );

    expect(report).not.toBeNull();
    expect(report?.failureCount).toBe(1);
  });

  it('an UNKNOWN shift is null — and the caller reports it', async () => {
    const report = await build([], []).executeForShift('NO-SUCH-SHIFT');
    expect(report).toBeNull();
  });
});
