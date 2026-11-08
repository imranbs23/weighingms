/**
 * The configuration and the locale — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT SUPPLIES NONE OF THE CONFIGURATION'S FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the change requires an operator session, and a **supervisor**
 *   - a client-supplied **actor**, **role**, **version**, **previous
 *     value** or **effective-from** is **dropped**
 *   - the reason is **mandatory**
 *   - the configuration's read is supervisor-gated
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

describe('the configuration — security', () => {
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

  it('refuses the change without a session', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'a reason',
      });

    expect(response.status).toBe(401);
  });

  it('refuses the change with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'a reason',
      });

    expect(response.status).toBe(401);
  });

  it('refuses the configuration’s READ without a session', async () => {
    const response = await request(harness.app).get('/api/configuration');
    expect(response.status).toBe(401);
  });

  it('refuses the configuration’s READ for an OPERATOR', async () => {
    const response = await request(harness.app)
      .get('/api/configuration')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('SUPERVISOR_REQUIRED');
  });

  it('DROPS a client-supplied actor, role, version and previous value', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'a reason',
        // The client TRIES to assert the store's facts.
        actorId: 'OP-SOMEONE-ELSE',
        actorRole: 'SUPERVISOR',
        version: 99,
        previousValue: '9.9999',
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(200);

    // The version is the STORE'S — the client's 99 was dropped.
    expect(response.body.version).toBe(1);
    // And the previous value is the store's read — there was none.
    expect(response.body.previousValue).toBeNull();
    // And the actor is the SESSION's.
    expect(response.body.actorId).toBe(SUPERVISOR_ID);

    // And the audit entry records the SESSION's actor, not the client's.
    const audit = await harness.tickets.audit.all();
    expect(audit[0]?.actorId).toBe(SUPERVISOR_ID);
  });

  it('a MISSING reason is refused — and nothing is written', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ value: '2.0000', category: 'TOLERANCE' });

    expect(response.status).toBe(400);

    // And no version, no audit entry.
    const read = await request(harness.app)
      .get('/api/configuration')
      .set('Authorization', `Bearer ${supervisorToken}`);
    expect(read.body.entries).toHaveLength(0);
    expect(await harness.tickets.audit.all()).toHaveLength(0);
  });

  it('the locale is served WITHOUT a session — it is operator-facing text', async () => {
    // The locale is a UI string, and the UI has strings before anybody
    // signs in — so this one is deliberately NOT session-gated.
    const response = await request(harness.app).get('/api/locale/ar/weigh.title');

    expect(response.status).toBe(200);
    expect(response.body.value).toBe('محطة الوزن');
  });
});
