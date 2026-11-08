/**
 * SqliteSurplusProposalRepository — the durable record of a proposal and
 * its decision.
 *
 * ══════════════════════════════════════════════════════════════════════
 * INSERT ONLY. AND THE DECISION IS A NEW ROW.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite a proposal (ADR-034). The database's triggers are the
 * second line of the same guarantee.
 *
 * **And the effective proposal is the NEWEST row** for the component — which
 * is the decision when there is one, and the proposal when there is not.
 */
import { SurplusProposal } from '../../domain/entities/surplus-proposal.js';
import { isProposalStatus } from '../../domain/entities/surplus-proposal.js';
import type { SurplusProposalRepository } from '../../domain/ports/surplus-proposal-repository.js';
import type { ComponentRecalculation } from '../../domain/services/compensation-calculator.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { SqliteDatabase } from './proposal-database.js';

interface ProposalRow {
  proposal_id: string;
  component_id: string;
  session_id: string;
  surplus_amount: string;
  overshoot: string;
  surplus_percent: string | null;
  factor: string;
  status: string;
  recalculated_json: string;
  operator_id: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  recorded_at: string;
}

export class SqliteSurplusProposalRepository
  implements SurplusProposalRepository
{
  /**
   * The insertion sequence.
   *
   * Two rows for one proposal land in the same millisecond, so a
   * time-based ordering would make "which is the decision" arbitrary. The
   * sequence breaks the tie in the order the acts **happened** — ADR-029's
   * rule applied to a decision.
   */
  private sequence = 0;

  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The `PROPOSED` row and the decision's row **share the `proposal_id`**,
   * and the pair `(proposal_id, status)` is the key — so a proposal can be
   * raised once and decided once, and neither row can be rewritten.
   */
  async save(proposal: SurplusProposal): Promise<void> {
    this.sequence += 1;
    this.db
      .prepare(
        `INSERT INTO surplus_proposals
           (proposal_id, component_id, session_id, surplus_amount, overshoot,
            surplus_percent, factor, status, recalculated_json, operator_id,
            reason, created_at, decided_at, recorded_at, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.proposalId,
        proposal.componentId,
        proposal.sessionId,
        proposal.surplusAmount.toJSON(),
        proposal.overshoot.toJSON(),
        proposal.surplusPercent,
        proposal.factor,
        proposal.status,
        JSON.stringify(
          proposal.recalculated.map((entry) => ({
            componentId: entry.componentId,
            originalTarget: entry.originalTarget.toJSON(),
            unit: entry.originalTarget.unit,
            revisedTarget: entry.revisedTarget.toJSON(),
          })),
        ),
        proposal.operatorId.value,
        proposal.reason,
        proposal.createdAt.toString(),
        proposal.decidedAt === null ? null : proposal.decidedAt.toString(),
        this.clock().toISOString(),
        this.sequence,
      );
  }

  /**
   * The effective proposal for a component — the **newest** row.
   *
   * `null` when no proposal has been raised. An un-proposed component is a
   * **state**, not an error.
   */
  async latestFor(componentId: string): Promise<SurplusProposal | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM surplus_proposals
          WHERE component_id = ?
          ORDER BY sequence DESC
          LIMIT 1`,
      )
      .get(componentId) as unknown as ProposalRow | undefined;

    return row === undefined ? null : toProposal(row);
  }
}

/**
 * Rebuild a proposal from its row.
 *
 * The status is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toProposal(row: ProposalRow): SurplusProposal {
  if (!isProposalStatus(row.status)) {
    throw new Error(
      `The stored proposal status "${row.status}" is not one this product records`,
    );
  }

  const recalculated = (
    JSON.parse(row.recalculated_json) as {
      componentId: string;
      originalTarget: string;
      unit: string;
      revisedTarget: string;
    }[]
  ).map(
    (entry): ComponentRecalculation => ({
      componentId: entry.componentId,
      originalTarget: WeightValue.of(entry.originalTarget, entry.unit),
      revisedTarget: WeightValue.of(entry.revisedTarget, entry.unit),
    }),
  );

  return new SurplusProposal(
    row.proposal_id,
    row.component_id,
    row.session_id,
    WeightValue.of(row.surplus_amount, 'g'),
    WeightValue.of(row.overshoot, 'g'),
    row.surplus_percent,
    row.factor,
    recalculated,
    OperatorId.create(row.operator_id),
    Instant.of(new Date(row.created_at)),
    row.status,
    row.decided_at === null ? null : Instant.of(new Date(row.decided_at)),
    row.reason,
  );
}
