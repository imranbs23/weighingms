/**
 * ProposeCompensation — the over-dose, the quantities, and the proposal.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTS, NOT THE DECISION. Q-06 IS NOT ANSWERED YET.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story is explicit: *"the detection logic here must not presuppose a
 * particular answer to Q-06; it produces the facts, and the compensation
 * rule consumes them."*
 *
 * So this use case produces the **over-dose** and its two quantities, asks
 * the **one** compensation implementation for the proposal and the
 * compensability decision, and **presents** the result. It does not apply
 * anything — the operator decides, and the decision is a separate call.
 *
 * AND THE PROPOSAL IS NOT ACCUMULATED
 * -----------------------------------
 * The surplus reflects the **latest** accepted reading. Multiple readings in
 * the `OVER` zone do not add up — the reading is the quantity, not the sum
 * of the readings.
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { RecipeWorkingCopy } from '../../../002-recipe-material-management/domain/services/recipe-working-copy.js';
import { SurplusProposal } from '../../domain/entities/surplus-proposal.js';
import type { SurplusProposalRepository } from '../../domain/ports/surplus-proposal-repository.js';
import { CompensationCalculator } from '../../domain/services/compensation-calculator.js';
import { OverdoseDetector } from '../../domain/services/overdose-detector.js';
import type { ToleranceZone } from '../../domain/value-objects/tolerance-zone.js';

export type ProposeCompensationOutcome =
  | {
      readonly kind: 'PROPOSED';
      readonly proposal: SurplusProposal;
      /** The over-dose's two quantities, for the operator. */
      readonly overshoot: WeightValue;
      readonly surplus: WeightValue;
      readonly surplusPercent: string | null;
    }
  | {
      /**
       * The surplus cannot be absorbed — no proposal, and the session
       * escalates (bolt `016`).
       */
      readonly kind: 'NOT_COMPENSABLE';
      readonly reason: string;
      readonly overshoot: WeightValue;
      readonly surplus: WeightValue;
      readonly surplusPercent: string | null;
    }
  | {
      /** The zone is not `OVER` — no surplus, and no over-dose response. */
      readonly kind: 'NOT_OVER';
      readonly zone: ToleranceZone;
    }
  | {
      /** There is no active component, or no reading. */
      readonly kind: 'NOT_AVAILABLE';
      readonly message: string;
    };

export interface ProposeCompensationOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** Where the proposal is recorded. */
  readonly proposals: SurplusProposalRepository;
  /** The detector. */
  readonly detector: OverdoseDetector;
  /** The ONE compensation implementation. */
  readonly calculator: CompensationCalculator;
  /** The current weight, net of the tare — the session's. */
  readonly currentWeight: () => WeightValue | null;
  /** The active component — the session's. */
  readonly activeComponentId: () => ComponentId | null;
  /** The current zone — bolt 014's engine. */
  readonly currentZone: () => ToleranceZone | null;
  /** The session's identity. */
  readonly sessionId: () => string;
  /** The clock. */
  readonly clock: () => Date;
}

export class ProposeCompensation {
  constructor(private readonly options: ProposeCompensationOptions) {}

  /**
   * Detect the over-dose and build the proposal.
   *
   * @param operatorId The operator — from the session.
   */
  async execute(operatorId: OperatorId): Promise<ProposeCompensationOutcome> {
    const componentId = this.options.activeComponentId();
    if (componentId === null) {
      return { kind: 'NOT_AVAILABLE', message: 'No component is active' };
    }

    const value = this.options.currentWeight();
    if (value === null) {
      return { kind: 'NOT_AVAILABLE', message: 'There is no reading yet' };
    }

    const zone = this.options.currentZone();
    if (zone === null) {
      return { kind: 'NOT_AVAILABLE', message: 'There is no zone yet' };
    }

    const recipe = this.options.workingCopy.current();
    if (recipe === null) {
      return { kind: 'NOT_AVAILABLE', message: 'No recipe is loaded' };
    }

    const component = recipe.componentById(componentId.value);
    if (component === undefined || component === null) {
      return { kind: 'NOT_AVAILABLE', message: 'The active component is unknown' };
    }

    // THE OVER-DOSE — detected and quantified. The zone is NOT recomputed.
    const overdose = this.options.detector.detect(
      value,
      component.target,
      component.tolerance,
      zone,
    );

    if (overdose.kind === 'NOT_OVER') {
      return { kind: 'NOT_OVER', zone: overdose.zone };
    }

    // THE REMAINING COMPONENTS — the ones AFTER the active one in recipe
    // sequence. Not "all the others": the components before the active one
    // have already been weighed, and their target cannot absorb a surplus.
    //
    // So the remaining set is the TAIL of the sequence — and the last
    // component has none, which is the case the story names: *"no
    // remaining components (last component over-dosed) → the surplus cannot
    // be absorbed — no proposal; escalate."*
    const activeSequence = component.sequence;
    const remaining = recipe.components
      .filter((entry) => entry.sequence > activeSequence)
      .map((entry) => ({
        componentId: entry.componentId.value,
        target: entry.target,
      }));

    // THE ONE IMPLEMENTATION — the proposal and the compensability decision
    // come from the same computation (ADR-038).
    const outcome = this.options.calculator.calculate(
      overdose.surplus,
      remaining,
    );

    if (outcome.kind === 'NOT_COMPENSABLE') {
      return {
        kind: 'NOT_COMPENSABLE',
        reason: outcome.reason,
        overshoot: overdose.overshoot,
        surplus: overdose.surplus,
        surplusPercent: overdose.surplusPercent,
      };
    }

    const proposal = new SurplusProposal(
      randomUUID(),
      component.componentId.value,
      this.options.sessionId(),
      overdose.surplus,
      overdose.overshoot,
      overdose.surplusPercent,
      outcome.factor,
      outcome.recalculated,
      operatorId,
      Instant.of(this.options.clock()),
    );

    await this.options.proposals.save(proposal);

    return {
      kind: 'PROPOSED',
      proposal,
      overshoot: overdose.overshoot,
      surplus: overdose.surplus,
      surplusPercent: overdose.surplusPercent,
    };
  }
}
