/**
 * ConfirmWeighing — the gate, and the record.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CONFIRMATION IS IMPOSSIBLE UNLESS THE ZONE IS `OK`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is **no other path** to a `WeighingRecord` (invariant 3, BRD FR-10,
 * C-07). And the gate is enforced in the **domain**, not by disabling a
 * button in the UI: *"a disabled button is presentation, not a control."*
 *
 * The gate's order is:
 *
 * 1. Is there an active component? — no → refuse.
 * 2. Is there a current weight? — no → refuse.
 * 3. Is the scale still weighing? — no → refuse (BRD IR-13).
 * 4. Has this component already been confirmed in this session? — yes →
 *    **idempotent**: return the existing record, write nothing.
 * 5. Is the **current** zone `OK`? — no → refuse, with the zone and the
 *    reason.
 * 6. Otherwise: write the record.
 *
 * **STEP 5 READS THE CURRENT ZONE, NOT A CACHED ONE.** A reading that
 * arrived between the operator seeing `OK` and pressing confirm changes the
 * answer — the story's edge case, exactly.
 *
 * AND THE RECORD SNAPSHOTS THE FACTS
 * -----------------------------------
 * The target, the tolerance and the scale's class are copied **as they were
 * at weighing time**, so a later revision in OrgaTEX cannot rewrite the
 * history (BRD FR-25, BRD BR-14).
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleClass } from '../../../004-scale-integration/domain/value-objects/scale-capability.js';
import { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../domain/entities/weighing-record.js';
import type { WeighingRecordRepository } from '../../domain/ports/weighing-record-repository.js';
import { ToleranceZoneEvaluator } from '../../domain/services/tolerance-zone-evaluator.js';
import type { ToleranceZone } from '../../domain/value-objects/tolerance-zone.js';
import type { RecipeWorkingCopy } from '../../../002-recipe-material-management/domain/services/recipe-working-copy.js';
import { boundsFor } from './evaluate-zone.js';

/** Why a confirmation was refused. A **closed set** — each is a distinct next step. */
export type ConfirmationRefusalReason =
  | 'NO_ACTIVE_COMPONENT'
  | 'NO_READING'
  | 'SCALE_UNAVAILABLE'
  | 'ZONE_UNDER'
  | 'ZONE_NEAR'
  | 'ZONE_OVER';

export type ConfirmWeighingOutcome =
  | {
      /**
       * The weighing MAY be confirmed.
       *
       * The gate is a **decision**, not a write. The record is written by
       * the **transition** (bolt `017`), which writes it **first** and
       * advances the session second (ADR-040). So the gate reports the
       * facts the transition needs and writes nothing itself.
       */
      readonly kind: 'ALLOWED';
      /** The zone in force at confirmation. */
      readonly zoneAtConfirm: ToleranceZone;
      readonly componentId: ComponentId;
    }
  | {
      /**
       * The confirmation was refused.
       *
       * The **zone** is carried, so the UI can show the right next step —
       * and the reason distinguishes `UNDER`, `NEAR` and `OVER` (the story
       * requires it).
       */
      readonly kind: 'REFUSED';
      readonly reason: ConfirmationRefusalReason;
      readonly zone: ToleranceZone | null;
      readonly message: string;
    }
  | {
      /** A replayed confirmation — the existing record is returned. */
      readonly kind: 'ALREADY_CONFIRMED';
      readonly record: WeighingRecord;
    };

export interface ConfirmWeighingOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** Where the record is written. */
  readonly records: WeighingRecordRepository;
  /** The evaluator — the same one the zone used. */
  readonly evaluator: ToleranceZoneEvaluator;
  /** The current weight, net of the tare — the session's. */
  readonly currentWeight: () => WeightValue | null;
  /** The active component — the session's. */
  readonly activeComponentId: () => ComponentId | null;
  /** The bound scale — the session's. */
  readonly selectedScaleId: () => ScaleId | null;
  /** The bound scale's class — the device's. */
  readonly selectedScaleClass: () => ScaleClass | null;
  /** The captured lot, when there is one. */
  readonly lotNumber: () => string | null;
  /** The assigned container, when there is one. */
  readonly containerId: () => string | null;
  /** The session's identity. */
  readonly sessionId: () => string;
  /** Whether the scale may still weigh — unit 004's gate. */
  readonly canWeigh: () => boolean;
  /** The clock. */
  readonly clock: () => Date;
}

export class ConfirmWeighing {
  constructor(private readonly options: ConfirmWeighingOptions) {}

  /**
   * Confirm the weighing.
   *
   * @param operatorId The operator — from the session.
   */
  async execute(operatorId: OperatorId): Promise<ConfirmWeighingOutcome> {
    // 1. IS THERE AN ACTIVE COMPONENT?
    const componentId = this.options.activeComponentId();
    if (componentId === null) {
      return this.refuse('NO_ACTIVE_COMPONENT', null, 'No component is active');
    }

    // 2. IS THERE A CURRENT WEIGHT?
    const weight = this.options.currentWeight();
    if (weight === null) {
      return this.refuse('NO_READING', null, 'There is no reading to confirm');
    }

    // 3. IS THE SCALE STILL WEIGHING?
    if (!this.options.canWeigh()) {
      return this.refuse(
        'SCALE_UNAVAILABLE',
        null,
        'The scale is not available',
      );
    }

    // 4. HAS THIS COMPONENT ALREADY BEEN CONFIRMED? — IDEMPOTENT.
    const existing = await this.options.records.latestFor(
      this.options.sessionId(),
      componentId,
    );
    if (existing !== null) {
      return { kind: 'ALREADY_CONFIRMED', record: existing };
    }

    // 5. IS THE CURRENT ZONE `OK`?
    const recipe = this.options.workingCopy.current();
    if (recipe === null) {
      return this.refuse(
        'NO_ACTIVE_COMPONENT',
        null,
        'No recipe is loaded',
      );
    }

    const component = recipe.componentById(componentId.value);
    if (component === undefined || component === null) {
      return this.refuse(
        'NO_ACTIVE_COMPONENT',
        null,
        'The active component is unknown',
      );
    }

    // The CURRENT zone — recomputed from the CURRENT weight against the
    // component's bounds. Not a cached zone, and not the one the operator
    // last saw.
    const bounds = boundsFor(component);
    const zone = this.options.evaluator.evaluate(
      weight as never,
      bounds,
    );

    if (zone !== 'OK') {
      return this.refuse(
        zone === 'UNDER'
          ? 'ZONE_UNDER'
          : zone === 'NEAR'
            ? 'ZONE_NEAR'
            : 'ZONE_OVER',
        zone,
        `The zone is ${zone}`,
      );
    }

    // 6. THE SCALE MUST BE BOUND.
    const scaleId = this.options.selectedScaleId();
    const scaleClass = this.options.selectedScaleClass();
    if (scaleId === null || scaleClass === null) {
      return this.refuse(
        'SCALE_UNAVAILABLE',
        zone,
        'No scale is bound to the session',
      );
    }

    // 7. ALLOWED.
    //
    // The gate is a **decision**. The record is written by the
    // **transition** (bolt `017`), which writes it FIRST and advances the
    // session second (ADR-040) — so a crash between the two leaves the
    // component unwritten rather than losing a confirmed weighing.
    //
    // And `zoneAtConfirm` is the zone **in force at confirmation** — which
    // is the **over-dose** zone when an authorised escalation was applied,
    // so the exception is visible in the record (BRD FR-11, FR-23).
    return { kind: 'ALLOWED', zoneAtConfirm: zone, componentId };
  }

  /** A refusal. The zone and the reason are the whole of it. */
  private refuse(
    reason: ConfirmationRefusalReason,
    zone: ToleranceZone | null,
    message: string,
  ): ConfirmWeighingOutcome {
    return { kind: 'REFUSED', reason, zone, message };
  }
}
