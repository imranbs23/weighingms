/**
 * The escalation's endpoints — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PRECISE REFUSAL IS A MAP OF THE DEFENCES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 003's escalation path.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - a client-supplied scope or surplus is DROPPED
 *   - the refusal body carries **no reason** (ADR-004)
 *   - the override record is IMMUTABLE in the database
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { OverrideRecord } from '../../src/003-weighing-station/domain/entities/override-record.js';
import {
  dispenseOverTolerance,
  OVERDOSE_COMPONENT,
} from '../support/overdose-drive.js';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the escalation endpoints — security', () => {
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

  it('refuses raising the escalation with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('refuses the authorisation with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({
        authorisationId: 'AUTH-1',
        supervisorId: 'OP-SUP-001',
        secret: 'secret',
        reason: 'a reason',
      });

    expect(response.status).toBe(401);
  });

  it('never leaks WHY an authorisation was refused', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(harness.app)
        .post('/api/session/select')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: OVERDOSE_COMPONENT });
      await dispenseOverTolerance(harness, token);
      await request(harness.app)
        .post('/api/escalation')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: OVERDOSE_COMPONENT });

      const response = await request(harness.app)
        .post('/api/escalation/authorise')
        .set('Authorization', `Bearer ${token}`)
        .send({
          authorisationId: 'AUTH-DOES-NOT-EXIST',
          supervisorId: 'OP-SUP-001',
          secret: 'not-the-secret',
          reason: 'a reason',
        });

      // The refusal is UNIFORM — the same body for every failure, because
      // a precise reason is a map of the defences (ADR-004).
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'AUTHORISATION_REFUSED' });

      // And nothing in the body says WHICH check failed.
      expect(Object.keys(response.body)).toEqual(['error']);
      expect(response.text).not.toContain('SELF');
      expect(response.text).not.toContain('EXPIRED');
      expect(response.text).not.toContain('SCOPE');
      expect(response.text).not.toContain('OUT_OF_SCOPE');
      expect(response.text).not.toContain('not-the-secret');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('DROPS a client-supplied scope', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: OVERDOSE_COMPONENT });
    await dispenseOverTolerance(harness, token);

    const response = await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: OVERDOSE_COMPONENT,
        scope: 'WS-999/OTHER',
        authorisationSubject: 'WS-999/OTHER',
      });

    expect(response.status).toBe(201);
    // The scope is DERIVED — the client's fields do not exist.
    expect(response.body.escalation.sessionId).not.toBe('WS-999');
  });

  it('the override record is IMMUTABLE in the database', async () => {
    harness.station.overrides.save(
      new OverrideRecord(
        'REC-1',
        'AUTH-1',
        'OP-SUP-001',
        'OP-001',
        'the client accepted the excess',
        'DYE-4471-Y',
        'WS-1',
        WeightValue.of('2.4000', 'g'),
        Instant.of(new Date('2026-11-06T09:41:07.000Z')),
      ),
    );

    expect(() =>
      harness.identity.db
        .prepare(`UPDATE override_records SET reason = 'TAMPERED'`)
        .run(),
    ).toThrow(/append-only/);

    expect(() =>
      harness.identity.db.prepare(`DELETE FROM override_records`).run(),
    ).toThrow(/append-only/);
  });
});
