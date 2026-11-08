/**
 * DecideProposal — the operator's decision on a presented proposal.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DECISION IS A NEW ROW. THE ORIGINAL IS UNTOUCHED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The `PROPOSED` row is **never updated** — the acceptance or the refusal
 * is a **new row** carrying the same `proposal_id`. So the history shows
 * that the proposal was made **before** it was decided, which is the shape of
 * an audit trail (ADR-029, ADR-034).
 *
 * **And a proposal can be decided ONCE.** A second decision is refused —
 * the record is not a thing to be re-decided.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { SurplusProposalRepository } from '../../domain/ports/surplus-proposal-repository.js';

export type DecideProposalOutcome =
  | {
      readonly kind: 'DECIDED';
      readonly proposalId: string;
      readonly status: 'ACCEPTED' | 'DECLINED';
      readonly decidedAt: string;
    }
  | {
      /** There is no proposal for this component. */
      readonly kind: 'NOT_FOUND';
      readonly message: string;
    }
  | {
      /** The proposal has already been decided. */
      readonly kind: 'ALREADY_DECIDED';
      readonly message: string;
    };

export interface DecideProposalOptions {
  /** Where the proposal is recorded. */
  readonly proposals: SurplusProposalRepository;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class DecideProposal {
  constructor(private readonly options: DecideProposalOptions) {}

  /**
   * Accept or decline a proposal.
   *
   * @param componentId The component the proposal is for.
   * @param decision `ACCEPTED` or `DECLINED`.
   * @param operatorId The operator — from the session.
   * @param reason The reason, when one is given (BRD FR-24).
   */
  async execute(
    componentId: string,
    decision: 'ACCEPTED' | 'DECLINED',
    operatorId: OperatorId,
    reason: string | null = null,
  ): Promise<DecideProposalOutcome> {
    const existing = await this.options.proposals.latestFor(componentId);

    if (existing === null) {
      this.options.onError?.(
        `[surplus] there is no proposal for component ${componentId}`,
      );
      return {
        kind: 'NOT_FOUND',
        message: `There is no proposal for component ${componentId}`,
      };
    }

    // ALREADY DECIDED. A proposal is decided once, and the record is not a
    // thing to be re-decided.
    if (existing.isDecided) {
      this.options.onError?.(
        `[surplus] the proposal ${existing.proposalId} has already been decided`,
      );
      return {
        kind: 'ALREADY_DECIDED',
        message: 'This proposal has already been decided',
      };
    }

    const decidedAt = Instant.of(this.options.clock());
    const decided = existing.decide(decision, operatorId, decidedAt, reason);

    // A NEW ROW. The `PROPOSED` row is untouched.
    await this.options.proposals.save(decided);

    return {
      kind: 'DECIDED',
      proposalId: decided.proposalId,
      status: decision,
      decidedAt: decidedAt.toString(),
    };
  }
}
