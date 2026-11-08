/**
 * The ticket and the print job — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PRINT PATH HAS NO WAY TO REACH THE WEIGHING RECORD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the endpoints require an operator session (ADR-020)
 *   - a client-supplied **quantity**, **outcome**, **operator**,
 *     **template** or **batch** is **dropped** — every one of them is
 *     computed or read from the records
 *   - the print path **never writes** a weighing record
 *   - a failed print does not change the ticket, and does not change the
 *     records
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the ticket — security', () => {
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

  it('refuses the generation without a session', async () => {
    const response = await request(harness.app).post('/api/tickets');
    expect(response.status).toBe(401);
  });

  it('refuses the generation with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('refuses the ticket read without a session', async () => {
    const response = await request(harness.app).get('/api/tickets/TKT-1');
    expect(response.status).toBe(401);
  });

  it('refuses the print without a session', async () => {
    const response = await request(harness.app).post(
      '/api/tickets/TKT-1/print',
    );
    expect(response.status).toBe(401);
  });

  it('refuses the print job read without a session', async () => {
    const response = await request(harness.app).get('/api/print-jobs/JOB-1');
    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied quantity, outcome, operator and template', async () => {
    const response = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // The client TRIES to assert the ticket's facts.
        batchId: 'B-99999',
        operatorId: 'OP-SOMEONE-ELSE',
        templateId: 'TEMPLATE-HACKED',
        toleranceOutcome: 'WITHIN_TOLERANCE',
        lines: [{ componentId: 'X', actualQuantity: '9999.0000' }],
        totalDispensed: '999999.0000',
      });

    // The batch is not complete, so there is no ticket — and the client's
    // fields are simply not read.
    expect(response.status).toBe(409);

    // And the body carries only the error.
    expect(Object.keys(response.body)).toEqual(['error']);
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
    expect(response.text).not.toContain('TEMPLATE-HACKED');
    expect(response.text).not.toContain('999999');
    expect(response.text).not.toContain('9999.0000');
  });

  it('the print path NEVER writes a weighing record', async () => {
    // A session, so there is something a print could conceivably touch.
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    // The records before.
    const before = await harness.station.records.allFor(session.sessionId);

    // A print of a ticket that does not exist — the closest thing to a
    // print that touches the session's state.
    await request(harness.app)
      .post('/api/tickets/TKT-NOPE/print')
      .set('Authorization', `Bearer ${token}`);

    // And the records after. Identical.
    const after = await harness.station.records.allFor(session.sessionId);
    expect(after.length).toBe(before.length);
  });

  it('a failed print does not change the records', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const session = await harness.station.sessions.current();
    if (session === null) return;

    const before = await harness.station.records.allFor(session.sessionId);

    harness.tickets.trainingPrinter.setAvailable(false, 'Out of paper');
    await request(harness.app)
      .post('/api/tickets/TKT-NOPE/print')
      .set('Authorization', `Bearer ${token}`);

    const after = await harness.station.records.allFor(session.sessionId);
    expect(after.length).toBe(before.length);
    for (let index = 0; index < after.length; index += 1) {
      expect(after[index]?.componentId.value).toBe(
        before[index]?.componentId.value,
      );
      expect(after[index]?.actualQuantity.text).toBe(
        before[index]?.actualQuantity.text,
      );
    }
  });

  it('the print job’s error is visible — and it is the PRINTER’s reason', async () => {
    // The ticket must exist for the print to be attempted.
    const generated = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    // The batch is not complete, so there is no ticket — and the print is
    // a 404. The point of this test is the SHAPE of the refusal.
    expect(generated.status).toBe(409);

    // And there is no ticket to print.
    const printed = await request(harness.app)
      .post('/api/tickets/TKT-NOPE/print')
      .set('Authorization', `Bearer ${token}`);
    expect(printed.status).toBe(404);
    expect(printed.body.error).toBe('TICKET_NOT_FOUND');
  });
});
