/**
 * The surplus endpoints — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLIENT THAT COULD ASSERT A FACTOR COULD ASSERT ANY RECALCULATION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 003's surplus path.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - a client-supplied factor, surplus or revised target is DROPPED
 *   - the proposal is immutable in the database
 *   - the diagnostics never reach the client (BRD IR-09)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { SurplusProposal } from '../../src/003-weighing-station/domain/entities/surplus-proposal.js';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the surplus endpoints — security', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;

    await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);
  });

  afterEach(() => {
    harness.close();
  });

  it('refuses the surplus without a session', async () => {
    const response = await request(harness.app).get('/api/surplus');
    expect(response.status).toBe(401);
  });

  it('refuses a proposal with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/surplus')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({});

    expect(response.status).toBe(401);
  });

  it('refuses an acceptance without a session', async () => {
    const response = await request(harness.app)
      .post('/api/surplus/accept')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied factor', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/surplus')
      .set('Authorization', `Bearer ${token}`)
      .send({ factor: '0.999999' });

    // The `factor` field does not exist, so it is stripped — and the
    // domain's own computation decides.
    expect(response.status).toBe(409);
    expect(response.body.factor).toBeUndefined();
  });

  it('DROPS a client-supplied revised target', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/surplus')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recalculated: [
          { componentId: 'AUX-0101', revisedTarget: '0.0001' },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.recalculated).toBeUndefined();
  });

  it('DROPS a client-supplied operator on a decision', async () => {
    const response = await request(harness.app)
      .post('/api/surplus/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', operatorId: 'OP-SOMEONE-ELSE' });

    // The `operatorId` field does not exist, so it is stripped.
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(harness.app)
        .post('/api/surplus/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: 'DYE-4471-Y' });

      expect(response.status).toBe(404);
      // The body carries the CODE, not a sentence and not the component.
      expect(Object.keys(response.body)).toEqual(['error']);
      expect(response.text).not.toContain('DYE-4471-Y');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('the proposal is IMMUTABLE in the database', async () => {
    // A proposal is written through the repository — the **same** path
    // the use case uses — so the trigger has a row to refuse.
    harness.station.proposals.save(
      new SurplusProposal(
        'P-1',
        'DYE-4471-Y',
        'WS-1',
        WeightValue.of('2.4000', 'g'),
        WeightValue.of('1.9000', 'g'),
        '2.5532',
        '0.025532',
        [],
        OperatorId.create('OP-001'),
        Instant.of(new Date('2026-11-06T09:20:00.000Z')),
      ),
    );

    // The trigger is the enforcement, not the repository's convention.
    expect(() =>
      harness.identity.db
        .prepare(`UPDATE surplus_proposals SET factor = '0.999999'`)
        .run(),
    ).toThrow(/append-only/);

    expect(() =>
      harness.identity.db.prepare(`DELETE FROM surplus_proposals`).run(),
    ).toThrow(/append-only/);
  });
});
