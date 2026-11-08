/**
 * The surplus proposal's persistence — unit 003, bolt 015.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DECISION IS A NEW ROW, AND THE FACTOR IS STORED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The `PROPOSED` row and the decision's row **share a `proposal_id`**, so
 * the history shows that the proposal was made **before** it was decided.
 * And the applied `factor` is stored, because **Q-06 is unanswered** — it
 * is the evidence of which rule produced the revision (ADR-038).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { SurplusProposal } from '../../src/003-weighing-station/domain/entities/surplus-proposal.js';
import {
  openProposalDatabase,
  type SqliteDatabase,
} from '../../src/003-weighing-station/infrastructure/persistence/proposal-database.js';
import {
  SqliteSurplusProposalRepository,
} from '../../src/003-weighing-station/infrastructure/persistence/sqlite-surplus-proposal-repository.js';

const AT = Instant.of(new Date('2026-11-06T09:20:00.000Z'));
const OPERATOR = OperatorId.create('OP-001');

describe('the surplus proposal persistence', () => {
  let db: SqliteDatabase;
  let proposals: SqliteSurplusProposalRepository;

  beforeEach(() => {
    db = openProposalDatabase(':memory:');
    proposals = new SqliteSurplusProposalRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function proposal(
    status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED' = 'PROPOSED',
    proposalId = 'P-1',
  ): SurplusProposal {
    return new SurplusProposal(
      proposalId,
      'DYE-4471-Y',
      'WS-1',
      WeightValue.of('2.4000', 'g'),
      WeightValue.of('1.9000', 'g'),
      '2.5532',
      '0.025532',
      [
        {
          componentId: 'AUX-0101',
          originalTarget: WeightValue.of('20.0000', 'g'),
          revisedTarget: WeightValue.of('20.5106', 'g'),
        },
      ],
      OPERATOR,
      AT,
      status,
      status === 'PROPOSED' ? null : AT,
      status === 'PROPOSED' ? null : 'the shade ratio must hold',
    );
  }

  it('is null when no proposal has been raised', async () => {
    expect(await proposals.latestFor('DYE-4471-Y')).toBeNull();
  });

  it('round-trips the proposal and its factor', async () => {
    await proposals.save(proposal());

    const read = await proposals.latestFor('DYE-4471-Y');
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(read.surplusAmount.text).toBe('2.4000');
    expect(read.overshoot.text).toBe('1.9000');
    expect(read.surplusPercent).toBe('2.5532');
    // THE FACTOR IS STORED — the evidence of which rule applied.
    expect(read.factor).toBe('0.025532');
    expect(read.status).toBe('PROPOSED');
    expect(read.recalculated[0]?.revisedTarget.text).toBe('20.5106');
  });

  it('the DECISION is a new row — the original is untouched', async () => {
    await proposals.save(proposal('PROPOSED', 'P-1'));
    await proposals.save(proposal('ACCEPTED', 'P-1'));

    const rows = db
      .prepare(
        `SELECT status FROM surplus_proposals WHERE proposal_id = 'P-1' ORDER BY sequence`,
      )
      .all() as { status: string }[];

    // TWO rows for the one proposal — the offer and the decision.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(['PROPOSED', 'ACCEPTED']);
  });

  it('the effective proposal is the NEWEST row — the decision', async () => {
    await proposals.save(proposal('PROPOSED', 'P-1'));
    await proposals.save(proposal('ACCEPTED', 'P-1'));

    const read = await proposals.latestFor('DYE-4471-Y');
    expect(read?.status).toBe('ACCEPTED');
    expect(read?.isDecided).toBe(true);
    expect(read?.reason).toBe('the shade ratio must hold');
  });

  it('refuses an UPDATE — the proposal is immutable', async () => {
    await proposals.save(proposal());

    expect(() =>
      db
        .prepare(`UPDATE surplus_proposals SET factor = '0.999999'`)
        .run(),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE — the proposal is immutable', async () => {
    await proposals.save(proposal());

    expect(() =>
      db.prepare(`DELETE FROM surplus_proposals`).run(),
    ).toThrow(/append-only/);
  });

  it('refuses a status outside the closed set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO surplus_proposals
             (proposal_id, component_id, session_id, surplus_amount, overshoot,
              surplus_percent, factor, status, recalculated_json, operator_id,
              reason, created_at, decided_at, recorded_at)
           VALUES ('P-9', 'C-1', 'WS-1', '2.4000', '1.9000', '2.5532',
                   '0.025532', 'GHOST', '[]', 'OP-1', NULL, ?, NULL, ?)`,
        )
        .run(AT.toString(), AT.toString()),
    ).toThrow();
  });
});
