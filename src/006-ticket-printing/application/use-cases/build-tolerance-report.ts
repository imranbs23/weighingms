/**
 * BuildToleranceReport — the report.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE READS, AND NOT ONE WRITE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The collaborators are the **read** sides only:
 *
 * - the weighing records, **period-scoped**;
 * - the audit trail, **period-scoped**;
 * - the station's own batch progress.
 *
 * **And there is no `record` call in this path** — so the report cannot
 * write, and it cannot write a *"report generated"* entry either. The
 * report is not a privileged action (ADR-046).
 */
import type { WeighingRecord } from '../../../003-weighing-station/domain/entities/weighing-record.js';
import type { AuditEntry } from '../../domain/entities/audit-entry.js';
import {
  type BatchProgress,
  type OverrideRow,
  type ReportPeriod,
  type ToleranceFailureRow,
  type ToleranceReport,
} from '../../domain/entities/tolerance-report.js';

/**
 * The record's read — **period-scoped**.
 *
 * The report needs the records that were weighed within the period, and
 * `allFor(sessionId)` cannot express that.
 */
export interface ReportRecordsPort {
  between(from: Date, to: Date): Promise<readonly WeighingRecord[]>;
}

/** The trail's read — **period-scoped**. */
export interface ReportAuditPort {
  filter(filter: {
    readonly from?: Date | null;
    readonly to?: Date | null;
    readonly action?: string | null;
  }): Promise<readonly AuditEntry[]>;
}

/** The station's own batch progress. */
export interface BatchProgressPort {
  progressFor(period: ReportPeriod): Promise<readonly BatchProgress[]>;
}

/**
 * The shift pattern — a CONFIGURATION value.
 *
 * **A named shift resolves to a range**, so the report's query is the same
 * whether the period was named or spelled out. One implementation, two
 * ways of naming the period.
 */
export interface ShiftPatternPort {
  /** The shift's start and end — `null` when the shift is unknown. */
  resolve(shift: string): Promise<{ from: Date; to: Date } | null>;
  /** The known shifts. */
  names(): readonly string[];
}

export interface BuildToleranceReportOptions {
  readonly records: ReportRecordsPort;
  readonly audit: ReportAuditPort;
  readonly progress: BatchProgressPort;
  readonly shifts: ShiftPatternPort;
}

export class BuildToleranceReport {
  constructor(private readonly options: BuildToleranceReportOptions) {}

  /**
   * The report for a period — a range, or a named shift.
   */
  async execute(period: ReportPeriod): Promise<ToleranceReport> {
    // ── THE RECORDS, PERIOD-SCOPED ──
    const records = await this.options.records.between(
      period.from,
      period.to,
    );

    // ── THE FAILURES ──
    //
    // **The zone is READ** — the record's own — and never recomputed.
    const failures: ToleranceFailureRow[] = records
      .filter((record) => record.zoneAtConfirm !== 'OK')
      .map((record) => ({
        sessionId: record.sessionId,
        componentId: record.componentId.value,
        zone: record.zoneAtConfirm,
        actualQuantity: record.actualQuantity.text,
        unit: record.actualQuantity.unit,
        operatorId: record.operatorId.value,
        weighedAt: record.weighedAt.toDate(),
      }));

    // ── THE OVERRIDES ──
    //
    // The trail's **tolerance override** entries — the supervisor's
    // authorisation of an out-of-tolerance over-dose. And NOT the
    // reprints, and NOT the configuration changes.
    const entries = await this.options.audit.filter({
      from: period.from,
      to: period.to,
      action: 'TOLERANCE_OVERRIDE',
    });

    // **AND THE JOIN.** The entry names the subject; the weighing carries
    // the subject's quantity. And the entry alone is not sufficient.
    const overrides: OverrideRow[] = entries.map((entry) => {
      const subject = parseSubject(entry.subject.value);
      const record = findRecord(records, subject);

      return {
        sequence: entry.sequence ?? 0,
        sessionId: subject.sessionId,
        componentId: subject.componentId,
        // The record's own quantity — when there is a record.
        actualQuantity: record?.actualQuantity.text ?? '',
        unit: record?.actualQuantity.unit ?? '',
        // The actor, the role, the reason and the time — from the entry.
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        reason: entry.reason,
        occurredAt: entry.occurredAt.toDate(),
      };
    });

    // ── THE PROGRESS ──
    const progress = await this.options.progress.progressFor(period);

    return {
      period,
      failureCount: failures.length,
      overrideCount: overrides.length,
      failures,
      overrides,
      progress,
    };
  }

  /**
   * The report for a **named shift** — resolved to a range.
   */
  async executeForShift(shift: string): Promise<ToleranceReport | null> {
    const resolved = await this.options.shifts.resolve(shift);
    if (resolved === null) return null;
    return this.execute(resolved);
  }
}

/**
 * The subject an audit entry names — the component and the session.
 *
 * **The subject is the link.** The trail and the records are joined by the
 * fact they share, not by a foreign key invented for reporting.
 */
function parseSubject(subject: string): {
  sessionId: string;
  componentId: string;
} {
  const fields = new Map<string, string>();
  for (const part of subject.split(';')) {
    const [key, value] = part.split('=');
    if (key !== undefined && value !== undefined) {
      fields.set(key.trim(), value.trim());
    }
  }

  return {
    sessionId: fields.get('session') ?? '',
    componentId: fields.get('component') ?? '',
  };
}

/**
 * The weighing an override refers to.
 *
 * **And two overrides on one subject are TWO rows** — this finds the
 * record for each entry, and the report never merges them.
 */
function findRecord(
  records: readonly WeighingRecord[],
  subject: { sessionId: string; componentId: string },
): WeighingRecord | undefined {
  return records.find(
    (record) =>
      record.sessionId === subject.sessionId &&
      record.componentId.value === subject.componentId,
  );
}
