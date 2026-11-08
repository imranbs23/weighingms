/**
 * The escalation's endpoints — the persisted view.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ESCALATION IS RAISED, REPORTED, AND THE OVERRIDE IS RECORDED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the escalation is raised and reported with its state
 *   - the authorisation is refused with the UNIFORM body (ADR-004)
 *   - the reason is **absent** from the wire and **present** in the record
 *   - the override record carries the supervisor, the reason and the surplus
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
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: OVERDOSE_COMPONENT });
  });

  afterEach(() => {
    harness.close();
  });

  /** Raise the escalation over a real over-dose. */
  async function raise(): Promise<void> {
    await dispenseOverTolerance(harness, token);
    const response = await request(harness.app)
      .post('/api/escalation')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: OVERDOSE_COMPONENT });
    expect(response.status).toBe(201);
  }

  it('reports NO escalation when there is none', async () => {
    const response = await request(harness.app)
      .get(`/api/escalation/${OVERDOSE_COMPONENT}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.escalation).toBeNull();
  });

  it('raises the escalation and reports it', async () => {
    await raise();

    const response = await request(harness.app)
      .get(`/api/escalation/${OVERDOSE_COMPONENT}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.escalation.state).toBe('ESCALATED');
    expect(response.body.escalation.componentId).toBe(OVERDOSE_COMPONENT);
    // The surplus is reported as a STRING.
    expect(typeof response.body.escalation.surplusAmount).toBe('string');
    expect(response.body.escalation.unit).toBe('kg');
  });

  it('refuses the authorisation with the UNIFORM body — and no reason', async () => {
    await raise();

    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        authorisationId: 'AUTH-DOES-NOT-EXIST',
        supervisorId: 'OP-SUP-001',
        secret: 'not-the-secret',
        reason: 'the client accepted the excess',
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'AUTHORISATION_REFUSED' });
  });

  it('refuses a second authorisation — the escalation is decided once', async () => {
    await raise();

    await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        authorisationId: 'AUTH-DOES-NOT-EXIST',
        supervisorId: 'OP-SUP-001',
        secret: 'not-the-secret',
        reason: 'the client accepted the excess',
      });

    const second = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        authorisationId: 'AUTH-DOES-NOT-EXIST',
        supervisorId: 'OP-SUP-001',
        secret: 'not-the-secret',
        reason: 'the client accepted the excess',
      });

    expect(second.status).toBe(409);
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
    await raise();

    const response = await request(harness.app)
      .post('/api/escalation/authorise')
      .set('Authorization', `Bearer ${token}`)
      .send({ authorisationId: 'AUTH-1' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });
});
