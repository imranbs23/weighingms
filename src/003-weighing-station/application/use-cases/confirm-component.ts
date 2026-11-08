/**
 * ConfirmComponent — the one transition.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RECORD IS WRITTEN FIRST. THEN THE SESSION ADVANCES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The order is the design (ADR-040):
 *
 * 1. **The gate accepts** — the zone is `OK`, or an authorised escalation
 *    has been consumed (bolt `016`).
 * 2. **The record is written.** A confirmed weighing is durable **before**
 *    the response is returned (BRD NFR-05).
 * 3. **The session advances** — the confirmed component becomes `DONE` and
 *    the next `PENDING` in recipe order becomes `ACTIVE`, in one
 *    transition.
 *
 * **A crash between 2 and 3 leaves the component `ACTIVE` and unwritten** —
 * so the operator re-confirms, and the duplicate is refused rather than a
 * second record written. The reverse order would lose a confirmed weighing
 * silently, and a missing record for a weighing that happened is exactly
 * the failure BRD BR-14 and DR-01 exist to prevent.
 *
 * AND THE DUPLICATE IS REFUSED BY A CONSTRAINT
 * ---------------------------------------------
 * A `UNIQUE` constraint on `(session_id, component_id)` — not a
 * check-then-write, which is racy under concurrency, and the race is
 * exactly the case the story names.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../domain/entities/weighing-record.js';
import type { ProgressionOutcome } from '../../domain/entities/weighing-session.js';
import type { WeighingRecordRepository } from '../../domain/ports/weighing-record-repository.js';
import type { WeighingSessionRepository } from '../../domain/ports/weighing-station-ports.js';
import type { RecipeWorkingCopy } from '../../../002-recipe-material-management/domain/services/recipe-working-copy.js';

export type ConfirmComponentOutcome =
  | {
      readonly kind: 'CONFIRMED';
      readonly record: WeighingRecord;
      readonly progression: ProgressionOutcome;
    }
  | {
      /**
       * The component was already confirmed.
       *
       * The duplicate is **refused**, not ignored — and the refusal comes
       * from the `UNIQUE` constraint, so it is atomic.
       */
      readonly kind: 'ALREADY_CONFIRMED';
      readonly message: string;
    }
  | {
      /** There is no session, or no active component. */
      readonly kind: 'NOT_AVAILABLE';
      readonly message: string;
    };

export interface ConfirmComponentOptions {
  /** The working copy — where the recipe's ORDER comes from. */
  readonly workingCopy: RecipeWorkingCopy;
  /** Where the record is written. */
  readonly records: WeighingRecordRepository;
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
  /** The current weight, net of the tare — the session's. */
  readonly currentWeight: () => WeightValueLike | null;
  /** The bound scale — the session's. */
  readonly selectedScaleId: () => ScaleId | null;
  /** The bound scale's class — the device's. */
  readonly selectedScaleClass: () => ScaleClassLike | null;
  /** The captured lot, when there is one. */
  readonly lotNumber: () => string | null;
  /** The assigned container, when there is one. */
  readonly containerId: () => string | null;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

/** The shape the current weight arrives in. */
interface WeightValueLike {
  readonly text: string;
  readonly unit: string;
  toJSON(): string;
}

/** The shape the scale's class arrives in. */
type ScaleClassLike = 'PRECISION' | 'FLOOR';

export class ConfirmComponent {
  constructor(private readonly options: ConfirmComponentOptions) {}

  /**
   * Confirm the active component.
   *
   * @param componentId The component being confirmed.
   * @param operatorId The operator — from the session.
   * @param zoneAtConfirm The zone in force at confirmation. It is the
   *   **over-dose** zone when an authorised escalation was applied, so the
   *   exception is visible in the record (BRD FR-11, FR-23).
   */
  async execute(
    componentId: string,
    operatorId: OperatorId,
    zoneAtConfirm: 'OVER' | 'OK' | 'NEAR' | 'UNDER',
  ): Promise<ConfirmComponentOutcome> {
    const session = this.options.sessions.current();
    if (session === null) {
      return { kind: 'NOT_AVAILABLE', message: 'There is no session' };
    }

    const active = session.activeComponentId;
    if (active === null) {
      return {
        kind: 'NOT_AVAILABLE',
        message: 'No component is active',
      };
    }

    if (active.value !== componentId) {
      return {
        kind: 'NOT_AVAILABLE',
        message: 'That component is not the active one',
      };
    }

    const weight = this.options.currentWeight();
    if (weight === null) {
      return { kind: 'NOT_AVAILABLE', message: 'There is no reading to confirm' };
    }

    const recipe = this.options.workingCopy.current();
    if (recipe === null) {
      return { kind: 'NOT_AVAILABLE', message: 'No recipe is loaded' };
    }

    const scaleId = this.options.selectedScaleId();
    const scaleClass = this.options.selectedScaleClass();
    if (scaleId === null || scaleClass === null) {
      return {
        kind: 'NOT_AVAILABLE',
        message: 'No scale is bound to the session',
      };
    }

    // THE RECIPE'S ORDER — read, never written (C-01). The session holds
    // the STATES; the recipe holds the ORDER.
    const recipeOrder = recipe.components.map((entry) => ({
      componentId: entry.componentId,
    }));
    const component = recipe.componentById(componentId);
    if (component === undefined || component === null) {
      return {
        kind: 'NOT_AVAILABLE',
        message: 'The component is not in the recipe',
      };
    }

    // ── THE RECORD. WRITTEN FIRST. ──
    //
    // Durable before the response is returned (BRD NFR-05), and the
    // duplicate is refused by the `UNIQUE` constraint rather than by a
    // check (ADR-040).
    const record = new WeighingRecord(
      `WR-${this.options.clock().getTime().toString(36)}-${active.value}`,
      session.sessionId,
      active,
      weight as never,
      // The target and the band are SNAPSHOTTED as they were at weighing
      // time, so a later revision cannot rewrite the history.
      component.target,
      component.tolerance,
      zoneAtConfirm,
      scaleId,
      scaleClass,
      this.options.lotNumber(),
      this.options.containerId(),
      operatorId,
      Instant.of(this.options.clock()),
    );

    try {
      await this.options.records.save(record);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // The duplicate is REFUSED — and the refusal is atomic.
        this.options.onError?.(
          `[weighing-station] component ${active.value} was already confirmed`,
        );
        return {
          kind: 'ALREADY_CONFIRMED',
          message: 'This component has already been confirmed',
        };
      }
      throw error;
    }

    // ── THE PROGRESSION. ONE TRANSITION. ──
    //
    // The confirmed component becomes `DONE` and the next `PENDING` in
    // recipe order becomes `ACTIVE`, in one operation — so a crash cannot
    // leave two `ACTIVE` components or a `DONE` component with no record.
    let progression: ProgressionOutcome;
    try {
      progression = session.confirm(active, recipeOrder);
    } catch (error) {
      const message = (error as Error).message;
      this.options.onError?.(
        `[weighing-station] the progression was refused: ${message}`,
      );
      return { kind: 'ALREADY_CONFIRMED', message };
    }

    // The session is saved AFTER the progression — so the component states
    // and the record agree.
    await this.options.sessions.save(session);

    return { kind: 'CONFIRMED', record, progression };
  }
}

/**
 * Is this error a UNIQUE constraint violation?
 *
 * `node:sqlite` surfaces a constraint failure as an Error whose message
 * contains the constraint name. The check is deliberately narrow — a
 * different error must be re-thrown, not swallowed into a refusal, because
 * swallowing a real fault would hide a defect.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') ||
    error.message.includes('SQLITE_CONSTRAINT_UNIQUE')
  );
}
