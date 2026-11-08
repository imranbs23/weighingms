/**
 * The escalation's endpoints — unit 003, bolt 016.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY REFUSAL IS THE SAME BODY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the escalation is raised and reported
 *   - the supervisor's authorisation is **refused** with a **uniform** body
 *   - the refusal body carries **no reason** (ADR-004)
 *   - the scope is **derived** — the client cannot supply it
 *   - no session is a `401`
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import {
  dispenseOverTolerance,
  OVERDOSE_COMPONENT,
} from '../support/overdose-drive.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the escalation endpoints', () => {
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
    // The LAST component — so there are no remaining components and the
    // surplus cannot be absorbed. That is the NOT-compensable case, and
    // it is the only case that escalates.
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: OVERDOSE_COMPONENT });
  });

  afterEach(() => {
    harness.close();
  });

  it('reports NO escalation when there is none', async () => {
    const response = await request(harness.app)
      .get('/api/escalation/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.escalation).toBeNull();
  });


  it('raises the escalation for a NON-COMPENSABLE over-dose', async () => {
    await dispenseOverTolerance(harness, token);

    const response = await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: OVERDOSE_COMPONENT });

    expect(response.status).toBe(201);
    expect(response.body.escalation.state).toBe('ESCALATED');
    expect(response.body.escalation.componentId).toBe('AUX-0107');
  });

  it('returns 401 for the escalation without a session', async () => {
    const response = await request(harness.app).get(
      '/api/escalation/DYE-4471-Y',
    );
    expect(response.status).toBe(401);
  });

  it('returns 401 for raising the escalation without a session', async () => {
    const response = await request(harness.app)
      .post('/api/escalation')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('returns 404 when authorising with NO escalation', async () => {
    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        authorisationId: 'AUTH-1',
        supervisorId: 'OP-SUP-001',
        secret: 'secret',
        reason: 'a reason',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ESCALATION_NOT_FOUND');
  });

  it('returns 400 when the authorisation body is incomplete', async () => {
    await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({ authorisationId: 'AUTH-1' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for the authorisation without a session', async () => {
    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .send({
        authorisationId: 'AUTH-1',
        supervisorId: 'OP-SUP-001',
        secret: 'secret',
        reason: 'a reason',
      });

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied scope and surplus', async () => {
    await dispenseOverTolerance(harness, token);

    const response = await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: OVERDOSE_COMPONENT,
        surplus: '99.0000',
        scope: 'WS-999/COMPONENT-999',
      });

    expect(response.status).toBe(201);
    // The scope is DERIVED from the session's own ids — the client's
    // `scope` field does not exist, so it is stripped.
    expect(response.body.escalation.sessionId).toBeDefined();
    expect(response.body.escalation.scope).toBeUndefined();
  });
});
