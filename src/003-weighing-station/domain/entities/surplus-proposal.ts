/**
 * SurplusProposal — the recalculation, presented for acceptance.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PRESENTED, NOT APPLIED. THE STATUS IS THE OPERATOR'S DECISION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * FR-22: the revised targets are *"presented for acceptance"*. So the
 * proposal is a **decision waiting for a decision** — and the model says so.
 * The proposal carries its own **status**, and the status is what the
 * operator chose.
 *
 * AND THE STATUS IS A TRANSITION, NOT A MUTATION
 * ----------------------------------------------
 * The `PROPOSED` row is **untouched**, and the acceptance is a **new row**
 * carrying the same `proposal_id`. So the history shows that the proposal
 * was made **before** it was decided — which is the shape of an audit
 * trail, and the same append-only rule every other record in this product
 * follows (ADR-029, ADR-034).
 *
 * AND THE FACTOR IS STORED
 * -----------------------
 * Because it is the **evidence of which rule produced the revision**, and
 * **Q-06 is still unanswered**. If FCI answers *"surplus compensation just
 * means displaying the excess"*, the compensation path is deleted — and the
 * stored factors are what remain: a row per over-dose saying what was
 * proposed, at what factor, and what the operator decided (ADR-038).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { ComponentRecalculation } from '../services/compensation-calculator.js';

/** The proposal's status. A **closed set** of three. */
export type ProposalStatus = 'PROPOSED' | 'ACCEPTED' | 'DECLINED';

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'PROPOSED',
  'ACCEPTED',
  'DECLINED',
];

/**
 * Is this a proposal status?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint.
 */
export function isProposalStatus(value: unknown): value is ProposalStatus {
  return (
    typeof value === 'string' &&
    (PROPOSAL_STATUSES as readonly string[]).includes(value)
  );
}

export class SurplusProposal {
  constructor(
    /** The proposal's identity — shared by the decision's row. */
    readonly proposalId: string,
    /** The component that was over-dosed. */
    readonly componentId: string,
    /** The session it belongs to. */
    readonly sessionId: string,
    /** The excess over the target. */
    readonly surplusAmount: WeightValue,
    /** The excess over the tolerance maximum. */
    readonly overshoot: WeightValue,
    /** The surplus as a percentage — `null` at a zero target. */
    readonly surplusPercent: string | null,
    /** The **computed** factor — never a constant (ADR-038). */
    readonly factor: string,
    /** The revised targets, for the remaining components only. */
    readonly recalculated: readonly ComponentRecalculation[],
    /** The operator who raised it. */
    readonly operatorId: OperatorId,
    /** When it was raised. */
    readonly createdAt: Instant,
    /** The operator's decision. */
    readonly status: ProposalStatus = 'PROPOSED',
    /** When it was decided — `null` while it is still proposed. */
    readonly decidedAt: Instant | null = null,
    /** The reason, when one was given (BRD FR-24). */
    readonly reason: string | null = null,
  ) {}

  /** Has the operator decided? */
  get isDecided(): boolean {
    return this.status !== 'PROPOSED';
  }

  /** The same proposal, decided. A **new** record, never a mutation. */
  decide(
    status: Extract<ProposalStatus, 'ACCEPTED' | 'DECLINED'>,
    operatorId: OperatorId,
    decidedAt: Instant,
    reason: string | null = null,
  ): SurplusProposal {
    return new SurplusProposal(
      this.proposalId,
      this.componentId,
      this.sessionId,
      this.surplusAmount,
      this.overshoot,
      this.surplusPercent,
      this.factor,
      this.recalculated,
      operatorId,
      this.createdAt,
      status,
      decidedAt,
      reason,
    );
  }
}
