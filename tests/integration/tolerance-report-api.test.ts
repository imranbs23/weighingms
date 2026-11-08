/**
 * The tolerance report — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SUPERVISOR'S ACT, AND IT MUTATES NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - an **operator** is refused — a `403`
 *   - a **supervisor** gets the report
 *   - a **zero period** is a `200` with zero counts — **not** an error
 *   - the request **creates nothing** — the trail and the records are
 *     identical before and after
 *   - a named **shift** resolves to a range
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';
const SUPERVISOR_ID = 'OP-SUP-001';
const SUPERVISOR_SECRET = '9931';

const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-11-30T23:59:59.000Z';

describe('the tolerance report', () => {
  let harness: Harness;
  let operatorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    await seedOperator(
      harness,
      SUPERVISOR_ID,
      'S. Aziz',
      'SUPERVISOR',
      SUPERVISOR_SECRET,
    );

    const operatorSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    operatorToken = operatorSignIn.body.token as string;

    const supervisorSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: SUPERVISOR_ID, secret: SUPERVISOR_SECRET });
    supervisorToken = supervisorSignIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('an OPERATOR is refused — the report is a supervisor’s act', async () => {
    const response = await request(harness.app)
      .get(`/api/report/tolerance?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('SUPERVISOR_REQUIRED');
  });

  it('a SUPERVISOR gets the report', async () => {
    const response = await request(harness.app)
      .get(`/api/report/tolerance?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.report).toBeDefined();
    expect(response.body.report.period.from).toBe(FROM);
    expect(response.body.report.period.to).toBe(TO);
  });

  it('a ZERO period is a 200 with zero counts — NOT an error', async () => {
    const response = await request(harness.app)
      .get(`/api/report/tolerance?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.report.failureCount).toBe(0);
    expect(response.body.report.overrideCount).toBe(0);
    expect(response.body.report.failures).toEqual([]);
    expect(response.body.report.overrides).toEqual([]);
  });

  it('the request MUTATES NOTHING — no record, no audit entry', async () => {
    const auditBefore = await harness.tickets.audit.all();
    const recordsBefore = await harness.station.records.allFor('WS-1');

    await request(harness.app)
      .get(`/api/report/tolerance?from=${FROM}&to=${TO}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    const auditAfter = await harness.tickets.audit.all();
    const recordsAfter = await harness.station.records.allFor('WS-1');

    // AND no "report generated" entry — the report is not a privileged
    // action.
    expect(auditAfter.length).toBe(auditBefore.length);
    expect(recordsAfter.length).toBe(recordsBefore.length);
  });

  it('a named SHIFT resolves to a range', async () => {
    const response = await request(harness.app)
      .get('/api/report/tolerance?shift=DAY')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.report.period.from).toBeDefined();
    expect(response.body.report.period.to).toBeDefined();
  });

  it('an UNKNOWN shift is a 404 — not a silent empty report', async () => {
    const response = await request(harness.app)
      .get('/api/report/tolerance?shift=NO-SUCH-SHIFT')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('UNKNOWN_SHIFT');
  });

  it('a MISSING period is a 400', async () => {
    const response = await request(harness.app)
      .get('/api/report/tolerance')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(400);
  });

  it('the report without a session is a 401', async () => {
    const response = await request(harness.app).get(
      `/api/report/tolerance?from=${FROM}&to=${TO}`,
    );
    expect(response.status).toBe(401);
  });
});
