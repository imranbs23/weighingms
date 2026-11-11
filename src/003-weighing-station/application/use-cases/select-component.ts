/**
 * SelectComponent — bind the scale, and start the weighing.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR NEVER CHOOSES THE SCALE. THE RULE DOES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD BR-05: the scale is determined from the component's target against
 * the selection rule, and *"the selection is automatic and requires no
 * operator input."*
 *
 * **So there is no `scaleId` in the request.** The rule resolves it, and
 * the session binds to the answer. A client-supplied scale would be a
 * client-supplied tolerance boundary in the same way the tare was
 * (ADR-035).
 *
 * AND THE RULE'S ANSWER IS PASSED THROUGH UNCHANGED
 * -------------------------------------------------
 * Unit `004`'s rule answers with a **discriminated union** — `SELECTED` or
 * `NO_DEVICE_CAN_WEIGH` (ADR-018). And `NO_DEVICE_CAN_WEIGH` is **not an
 * error**: the question "which scale?" has been answered correctly, and
 * the answer carries the target and the maximum available capacity so the
 * caller can say why.
 *
 * So the "no device" case is a **refusal with data**, and the session does
 * **not** enter `WEIGHING`.
 *
 * AND THE GATE IS CONSULTED
 * ------------------------
 * The rule's chosen device is checked against the weighing gate — expired
 * calibration, disconnected, unknown (BRD FR-12, BRD BR-24, AC-14). So a
 * scale whose calibration has expired is refused **at selection**, and the
 * reason is unit `004`'s own vocabulary, passed through unchanged.
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import {
  ComponentId,
  type BatchId,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { RecipeWorkingCopy } from '../../../002-recipe-material-management/domain/services/recipe-working-copy.js';
import type {
  ScaleSelectionPort,
  WeighingSessionRepository,
} from '../../domain/ports/weighing-station-ports.js';
import { WeighingSession } from '../../domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../domain/entities/weighing-session.js';

export type SelectComponentOutcome =
  | {
      readonly kind: 'SELECTED';
      readonly session: WeighingSession;
      readonly scaleId: ScaleId;
    }
  | {
      /**
       * NO DEVICE CAN WEIGH THIS TARGET.
       *
       * A **successful** answer to a well-formed question, carrying the
       * target and the maximum available capacity (ADR-018).
       */
      readonly kind: 'NO_DEVICE_CAN_WEIGH';
      readonly target: string;
      readonly maximumCapacity: string;
      readonly demandedClass: string;
    }
  | {
      /** The chosen scale may not weigh — expired calibration, or gone. */
      readonly kind: 'SCALE_UNAVAILABLE';
      readonly reason: string;
    }
  | {
      /** The component is `DONE` — terminal (C-08). */
      readonly kind: 'COMPONENT_ALREADY_DONE';
      readonly message: string;
    }
  | {
      /** The recipe holds no such component. */
      readonly kind: 'UNKNOWN_COMPONENT';
      readonly message: string;
    };

export interface SelectComponentOptions {
  /**
   * The working copy — where the recipe being worked is held.
   *
   * The recipe is **read**, not copied: it is unit `002`'s fact, and this
   * unit does not hold a second copy of it (ADR-036).
   */
  readonly workingCopy: RecipeWorkingCopy;
  /** The rule — unit 004's. */
  readonly selection: ScaleSelectionPort;
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
  /** The clock. */
  readonly clock: () => Date;
  /**
   * The session is now bound to a device.
   *
   * The caller **subscribes to the device's stream** here — because the
   * session is the subscriber, and the subscription must be established
   * exactly when the binding happens (NFR-01: the weight is pushed, not
   * polled).
   */
  readonly onScaleBound?: (scaleId: ScaleId) => void;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class SelectComponent {
  constructor(private readonly options: SelectComponentOptions) {}

  /**
   * Select a component and bind its scale.
   *
   * @param componentId The recipe slot the operator selected.
   * @param operatorId The operator — from the session.
   */
  async execute(
    componentId: string,
    operatorId: string,
  ): Promise<SelectComponentOutcome> {
    const recipe = this.options.workingCopy.current();
    if (recipe === null) {
      this.options.onError?.(
        '[weighing-station] no recipe is loaded, so no component can be selected',
      );
      return {
        kind: 'UNKNOWN_COMPONENT',
        message: 'No recipe is loaded',
      };
    }

    const component = recipe.componentById(componentId);
    if (component === undefined || component === null) {
      this.options.onError?.(
        `[weighing-station] the recipe has no component ${componentId}`,
      );
      return {
        kind: 'UNKNOWN_COMPONENT',
        message: `The recipe has no component ${componentId}`,
      };
    }

    // A component with no demanded class cannot be weighed — the unit does
    // not guess a scale.
    if (component.scaleClass === null) {
      this.options.onError?.(
        `[weighing-station] component ${componentId} demands no scale class`,
      );
      return {
        kind: 'NO_DEVICE_CAN_WEIGH',
        target: component.target.toJSON(),
        maximumCapacity: component.target.toJSON(),
        demandedClass: 'UNAVAILABLE',
      };
    }

    // THE RULE. Unit 004's — the threshold is its configuration, and this
    // unit hard-codes nothing (ADR-019).
    const outcome = await this.options.selection.select(
      component.target,
      component.scaleClass,
      component.componentId.value,
    );

    if (outcome.kind === 'NO_DEVICE_CAN_WEIGH') {
      this.options.onError?.(
        `[weighing-station] no device can weigh ${outcome.target.text} for component ${componentId}`,
      );
      return {
        kind: 'NO_DEVICE_CAN_WEIGH',
        target: outcome.target.toJSON(),
        maximumCapacity: outcome.maximumCapacity.toJSON(),
        demandedClass: outcome.demandedClass,
      };
    }

    const selection = outcome.selection;
    const scaleId = selection.scaleId;

    // THE GATE. The rule chose a device; the gate says whether it may
    // weigh. The device is proved present first, so the gate's verdict is
    // about a device we have heard from. A device whose calibration has
    // expired is refused HERE (BRD FR-12, BRD BR-24, AC-14).
    const verdict = await this.options.selection.bindScale(scaleId);
    if (!verdict.allowed) {
      this.options.onError?.(
        `[weighing-station] the scale ${scaleId.value} may not weigh: ${verdict.reason ?? 'UNKNOWN'}`,
      );
      return {
        kind: 'SCALE_UNAVAILABLE',
        reason: verdict.reason ?? 'SCALE_NOT_RESPONDING',
      };
    }

    // The existing session is continued only while it is THIS batch's and
    // unfinished — a completed batch, or another batch, starts a new one.
    const existing = this.options.sessions.current();
    const session =
      existing !== null &&
      existing.batchId.value === recipe.batchId.value &&
      existing.state !== 'COMPLETE'
        ? existing
        : this.newSession(recipe.batchId, operatorId, recipe.components);

    // `DONE` IS TERMINAL. The aggregate refuses it.
    try {
      session.selectComponent(component.componentId, scaleId);
    } catch (error) {
      const message = (error as Error).message;
      this.options.onError?.(
        `[weighing-station] the component ${componentId} could not be selected: ${message}`,
      );
      return {
        kind: message.includes('DONE')
          ? 'COMPONENT_ALREADY_DONE'
          : 'UNKNOWN_COMPONENT',
        message,
      };
    }

    // The component's UNIT is the recipe's fact — read, not copied.
    session.componentUnit = component.target.unit;

    // THE SUBSCRIPTION — established exactly when the binding happens, so
    // the session receives the device's readings from the first one.
    this.options.onScaleBound?.(scaleId);

    await this.options.sessions.save(session);

    return { kind: 'SELECTED', session, scaleId };
  }

  /** A fresh session for a batch. */
  private newSession(
    batchId: BatchId,
    operatorId: string,
    components: readonly { readonly componentId: ComponentId }[],
  ): WeighingSession {
    return new WeighingSession({
      // The time keeps ids readable; the random suffix keeps them UNIQUE —
      // two sessions started in the same millisecond (or under a test
      // clock) must never share a row, or the upsert would overwrite one.
      sessionId: `WS-${this.options.clock().getTime().toString(36)}-${randomUUID().slice(0, 8)}`,
      batchId,
      operatorId: OperatorId.create(operatorId),
      startedAt: Instant.of(this.options.clock()),
      components: components.map(
        (entry): ComponentProgress => ({
          componentId: entry.componentId,
          state: 'PENDING',
        }),
      ),
    });
  }
}
