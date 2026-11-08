/**
 * CompleteBatch — the write-back, then the summary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE WRITE-BACK'S OUTCOME DOES NOT GATE THE COMPLETION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The order:
 *
 * 1. **The batch must be `COMPLETE`** — bolt `017`'s progression said so,
 *    and no component may remain `PENDING`.
 * 2. **Each confirmed record's consumption is posted** — unit 005's
 *    service, whose ledger is the atomic duplicate guard.
 * 3. **The batch's status is advanced to `WEIGHED`** — unit 005's service,
 *    whose precondition is that every posting is resolved.
 * 4. **The summary is computed** from the records.
 * 5. **The write-back's state is reported** — `CONFIRMED`, `PENDING` or
 *    `FAILED`.
 *
 * **And step 5's outcome does not change step 1.** The material is
 * weighed and in the container whether or not the MES heard about it; the
 * queue delivers a pending posting when the link returns (BRD FR-30,
 * FR-31, NFR-03). A pending write-back does not un-complete the batch
 * (ADR-041).
 *
 * AND ONLY THE CONFIRMED RECORDS COUNT
 * ------------------------------------
 * An abandoned attempt contributes nothing to the total or the count —
 * the summary reads the **confirmed** records, and the session's
 * component states tell it which components are `DONE`.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { WeighingRecord } from '../../domain/entities/weighing-record.js';
import {
  toleranceVerdict,
  type BatchSummary,
  type WriteBackState,
} from '../../domain/entities/batch-summary.js';
import {
  TotalDispensedCalculator,
} from '../../domain/services/total-dispensed-calculator.js';
import type {
  OrgatexWriteBackPort,
  BatchFactsPort,
} from '../../domain/ports/orgatex-write-back-port.js';
import type { WeighingRecordRepository } from '../../domain/ports/weighing-record-repository.js';
import type { WeighingSessionRepository } from '../../domain/ports/weighing-station-ports.js';

export type CompleteBatchOutcome =
  | {
      readonly kind: 'COMPLETED';
      readonly summary: BatchSummary;
    }
  | {
      /** The batch is not complete — no component may remain `PENDING`. */
      readonly kind: 'NOT_COMPLETE';
      readonly message: string;
    }
  | {
      /** There is no session, or it is not this batch's. */
      readonly kind: 'NOT_AVAILABLE';
      readonly message: string;
    };

export interface CompleteBatchOptions {
  /** The session — the batch's own live state. */
  readonly sessions: WeighingSessionRepository;
  /** The confirmed records. */
  readonly records: WeighingRecordRepository;
  /** Unit 005's write path. */
  readonly writeBack: OrgatexWriteBackPort;
  /** The batch's facts — the MES's, read through a port. */
  readonly batchFacts: BatchFactsPort;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class CompleteBatch {
  constructor(private readonly options: CompleteBatchOptions) {}

  /**
   * Complete the batch and produce its summary.
   */
  async execute(batchId: string): Promise<CompleteBatchOutcome> {
    const session = this.options.sessions.current();
    if (session === null) {
      return { kind: 'NOT_AVAILABLE', message: 'There is no session' };
    }

    if (session.batchId.value !== batchId) {
      return {
        kind: 'NOT_AVAILABLE',
        message: 'That is not the session’s batch',
      };
    }

    // ── THE BATCH MUST BE COMPLETE ──
    //
    // The session's state says so, and **no component may remain
    // `PENDING`** (invariant 4).
    const pending = session.components.filter(
      (entry) => entry.state === 'PENDING',
    );
    if (session.state !== 'COMPLETE' || pending.length > 0) {
      return {
        kind: 'NOT_COMPLETE',
        message: 'The batch is not complete',
      };
    }

    // ── THE CONFIRMED RECORDS ──
    //
    // Only the **confirmed** ones. An abandoned attempt contributes
    // nothing.
    const confirmed: WeighingRecord[] = [];
    for (const entry of session.components) {
      if (entry.state !== 'DONE') continue;
      const record = await this.options.records.latestFor(
        session.sessionId,
        entry.componentId,
      );
      if (record !== null) confirmed.push(record);
    }

    // ── THE WRITE-BACK. UNIT 005'S SERVICES. ──
    //
    // The posting is **idempotent** — unit 005's ledger is the atomic
    // guard, and a retry after an ambiguous failure does not double-post
    // (BRD IR-08, C-14).
    const writeBack = await this.postConsumptions(session, confirmed);

    // ── THE SUMMARY ──
    const total = new TotalDispensedCalculator().total(
      confirmed.map((record) => record.actualQuantity),
    );

    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (this.options.clock().getTime() -
          session.startedAt.toDate().getTime()) /
          1000,
      ),
    );

    const summary: BatchSummary = {
      batchId: session.batchId.value,
      sessionId: session.sessionId,
      completedCount: confirmed.length,
      totalCount: session.componentCount,
      elapsedSeconds,
      operatorId: session.operatorId.value,
      totalDispensed: total,
      // The verdict reads the records' zones — so an authorised override,
      // whose record carries the **over-dose** zone, makes it `NO`
      // without this code knowing anything about overrides.
      allWithinTolerance: toleranceVerdict(
        confirmed.map((record) => record.zoneAtConfirm),
      ),
      writeBack: writeBack.state,
      writeBackConfirmedAt: writeBack.confirmedAt,
      // The container is released — the weighing is done, whatever the
      // MES has said.
      releasedForTransport: true,
      targetMachine:
        (await this.options.batchFacts.targetMachine(session.batchId)) ??
        'UNKNOWN',
    };

    return { kind: 'COMPLETED', summary };
  }

  /**
   * Post each confirmed record's consumption, then advance the batch's
   * status.
   *
   * **And the outcome is reported, never thrown.** A MES that cannot be
   * reached is a **value** — `PENDING` — and not a failure of the
   * weighing (BRD FR-30, IR-09).
   */
  private async postConsumptions(
    session: { readonly batchId: BatchId; readonly operatorId: { value: string } },
    confirmed: readonly WeighingRecord[],
  ): Promise<{ state: WriteBackState; confirmedAt: Date | null }> {
    let allAccepted = true;
    let anyPending = false;

    for (const record of confirmed) {
      // The lot is the record's own — the capture unit `002` recorded.
      const lot = record.lotNumber ?? 'UNKNOWN';

      const outcome = await this.options.writeBack.postConsumption({
        batchId: session.batchId,
        componentId: ComponentId.create(record.componentId.value),
        actualQuantity: record.actualQuantity,
        lotNumber: LotNumber.create(lot),
        operatorId: OperatorReference.create(session.operatorId.value),
        weighedAt: record.weighedAt,
      });

      if (outcome.kind === 'QUEUED') {
        anyPending = true;
      } else if (outcome.kind === 'REJECTED') {
        allAccepted = false;
      } else if (outcome.kind === 'DUPLICATE' && !outcome.alreadyAccepted) {
        anyPending = true;
      }
    }

    if (!allAccepted) {
      return { state: 'FAILED', confirmedAt: null };
    }

    // THE BATCH'S STATUS. Unit 005's precondition applies — the write
    // happens only when every one of the batch's postings is resolved.
    const status = await this.options.writeBack.advanceBatchStatus(
      session.batchId,
    );

    if (status.kind === 'WRITTEN') {
      return { state: 'CONFIRMED', confirmedAt: this.options.clock() };
    }

    if (status.kind === 'POSTINGS_UNRESOLVED' || status.kind === 'QUEUED') {
      // PENDING. The batch is **not** un-completed — the material is
      // weighed and in the container, and the queue will deliver the
      // posting when the link returns.
      anyPending = true;
    }

    if (status.kind === 'REJECTED') {
      return { state: 'FAILED', confirmedAt: null };
    }

    return {
      state: anyPending ? 'PENDING' : 'CONFIRMED',
      confirmedAt: anyPending ? null : this.options.clock(),
    };
  }
}
