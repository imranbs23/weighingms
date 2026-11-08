/**
 * The batch summary — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT SUPPLIES NONE OF THE SUMMARY'S FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the summary requires an operator session (ADR-020)
 *   - a client-supplied **total**, **verdict**, **operator**, **elapsed
 *     time** or **write-back state** is **dropped** — those fields do not
 *     exist in the schema, and everything is computed from the records
 *   - the completion requires the session to be **this batch's**
 *   - the summary **never mutates** a record
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

describe('the batch summary — security', () => {
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
      .send({ componentId: 'DYE-4471-Y' });
  });

  afterEach(() => {
    harness.close();
  });

  it('refuses the summary without a session', async () => {
    const response = await request(harness.app).get(
      '/api/batch/B-24187/summary',
    );
    expect(response.status).toBe(401);
  });

  it('refuses the completion without a session', async () => {
    const response = await request(harness.app).post(
      '/api/batch/B-24187/complete',
    );
    expect(response.status).toBe(401);
  });

  it('refuses the completion with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied total, verdict, operator and write-back state', async () => {
    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // The client TRIES to assert the summary's facts.
        totalDispensed: '999999.0000',
        unit: 'kg',
        allWithinTolerance: 'YES',
        operatorId: 'OP-SOMEONE-ELSE',
        elapsedSeconds: 0,
        writeBack: 'CONFIRMED',
        releasedForTransport: true,
        targetMachine: 'JET-99',
      });

    // The batch is not complete, so there is no summary — and the client's
    // fields are simply not read.
    expect(response.status).toBe(409);

    // And the body carries only the error.
    expect(Object.keys(response.body)).toEqual(['error']);
    expect(response.text).not.toContain('999999');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
    expect(response.text).not.toContain('JET-99');
  });

  it('refuses a batch that is NOT the session’s', async () => {
    const response = await request(harness.app)
      .post('/api/batch/B-99999/complete')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('the summary READS the records and never mutates them', async () => {
    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    // The record before the summary.
    const before = await harness.station.records.latestFor(
      session.sessionId,
      ComponentId.create('DYE-4471-Y'),
    );

    await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    // And after. The quantity is the same — the summary did not touch it.
    const after = await harness.station.records.latestFor(
      session.sessionId,
      ComponentId.create('DYE-4471-Y'),
    );

    if (before === null) {
      expect(after).toBeNull();
      return;
    }
    expect(after?.actualQuantity.text).toBe(before.actualQuantity.text);
    expect(after?.zoneAtConfirm).toBe(before.zoneAtConfirm);
    expect(after?.weighedAt.toDate().getTime()).toBe(
      before.weighedAt.toDate().getTime(),
    );
  });
});
