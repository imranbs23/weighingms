/**
 * SurplusProposalRepository — the durable record of a proposal and its
 * decision.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. THE DECISION IS A NEW ROW.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story requires it: *"the proposal itself is persisted as one row per
 * over-dose"* — and the applied compensation is *"recorded with the
 * authorising user and the reason, and retained for ≥ 5 years"* (BRD FR-24,
 * DR-01).
 *
 * So the `PROPOSED` row and the decision's row **share a `proposal_id`**,
 * and the repository's `latestFor` returns the **newest** row — which is
 * the decision when there is one.
 *
 * That is ADR-029's shape applied to a decision rather than to a
 * supersession, and it means the history shows that the proposal was made
 * **before** it was decided.
 */
import type { SurplusProposal } from '../entities/surplus-proposal.js';

export interface SurplusProposalRepository {
  /**
   * Record a proposal or a decision.
   *
   * INSERT ONLY. The repository has no update method, so there is nothing
   * that *could* rewrite a proposal — and the database's triggers are the
   * second line of the same guarantee (ADR-034).
   */
  save(proposal: SurplusProposal): Promise<void>;

  /**
   * The effective proposal for a component — the **newest** row.
   *
   * `null` when no proposal has been raised. An un-proposed component is a
   * **state**, not an error.
   */
  latestFor(componentId: string): Promise<SurplusProposal | null>;
}
