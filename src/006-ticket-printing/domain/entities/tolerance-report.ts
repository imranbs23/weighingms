/**
 * ToleranceReport — the operational report over a period.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A READ MODEL. IT READS THE RECORDED ZONE, AND IT MUTATES NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE ZONE IS READ, NEVER RECOMPUTED
 * ----------------------------------
 * *"The tolerance outcome is read from the zone recorded at confirmation
 * on the weighing record, not recomputed from the current recipe and the
 * current tolerance configuration. A recipe or tolerance revision after the
 * fact must not change what the report says happened."*
 *
 * **And bolt `022` is what makes this load-bearing** — the configuration
 * is versioned, and a tolerance override changes what a weighing means. So
 * a recomputing report would **silently re-judge every historical
 * weighing** after a change, and turn a period with failures into a period
 * with none — with the same confidence either way (ADR-046).
 *
 * AND IT WRITES NOTHING
 * --------------------
 * *"A report request must not create, update or delete a record of any
 * kind, including a 'report generated' audit entry — the report is not a
 * privileged action."*
 *
 * So the collaborators are the **read** sides only, and there is no
 * `record` call anywhere in this path.
 */
import type { ToleranceZone } from '../../../003-weighing-station/domain/value-objects/tolerance-zone.js';

/** One weighing whose **recorded** zone was not `OK`. */
export interface ToleranceFailureRow {
  /** The session the weighing belongs to. */
  readonly sessionId: string;
  /** The component that was weighed. */
  readonly componentId: string;
  /** The zone **recorded at confirmation** — never recomputed. */
  readonly zone: ToleranceZone;
  /** The quantity — the record's **own** string. */
  readonly actualQuantity: string;
  readonly unit: string;
  /** Who confirmed it. */
  readonly operatorId: string;
  /** When it was weighed. */
  readonly weighedAt: Date;
}

/**
 * One supervisor-authorised override, **joined** to the weighing it
 * refers to.
 *
 * *"The audit entry alone is not sufficient, because the subject is what
 * makes the row meaningful."*
 */
export interface OverrideRow {
  /** The audit entry's sequence — the trail's own identity. */
  readonly sequence: number;
  /** The subject weighed — from the weighing the entry refers to. */
  readonly sessionId: string;
  readonly componentId: string;
  /** The actual quantity — the record's own string. */
  readonly actualQuantity: string;
  readonly unit: string;
  /** Who authorised it. */
  readonly actorId: string;
  /** Their role. */
  readonly actorRole: string;
  /** Why. */
  readonly reason: string;
  /** When it was authorised. */
  readonly occurredAt: Date;
}

/**
 * The batch weighing progress for the period — so a supervisor can see
 * where batches are without visiting the station (BRD BR-22).
 *
 * **The station's own batches** — unit `001`'s queue and unit `003`'s
 * sessions. The MES's own status is not the report's subject.
 */
export interface BatchProgress {
  readonly batchId: string;
  /** How many components were weighed. */
  readonly weighed: number;
  /** How many there are. */
  readonly total: number;
  /** The batch's state. */
  readonly state: string;
}

/** The report's period — a range, or a named shift resolved to one. */
export interface ReportPeriod {
  readonly from: Date;
  readonly to: Date;
}

export interface ToleranceReport {
  readonly period: ReportPeriod;
  /** How many weighings were outside tolerance. */
  readonly failureCount: number;
  /** How many overrides were authorised. */
  readonly overrideCount: number;
  /** The failure rows. */
  readonly failures: readonly ToleranceFailureRow[];
  /** The override rows. */
  readonly overrides: readonly OverrideRow[];
  /** The batch progress for the period. */
  readonly progress: readonly BatchProgress[];
}
