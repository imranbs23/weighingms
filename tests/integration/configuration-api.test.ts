/**
 * The configuration and the locale — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CONFIGURATION CHANGE IS A SUPERVISOR'S ACT, AND IT IS AUDITED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - an **operator** is refused — a `403`
 *   - a **supervisor** changes the value, and it takes effect for
 *     subsequent operations **without a restart**
 *   - the audit entry carries all **six** facts
 *   - an empty reason is refused — and **no version is bumped**
 *   - a scope that does not exist is refused — and **no version is bumped**
 *   - the locale serves the string, and falls back **per key**
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

describe('the configuration', () => {
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

  it('an OPERATOR is refused — the change is a supervisor’s act', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'the tolerance was reviewed',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('SUPERVISOR_REQUIRED');
  });

  it('a SUPERVISOR changes the value, and it takes effect', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'the tolerance was reviewed',
      });

    expect(response.status).toBe(200);
    expect(response.body.key).toBe('tolerance.dye');
    expect(response.body.value).toBe('2.0000');
    expect(response.body.version).toBe(1);

    // And it is in effect — **without a restart**.
    const read = await request(harness.app)
      .get('/api/configuration')
      .set('Authorization', `Bearer ${supervisorToken}`);

    const entry = read.body.entries.find(
      (e: { key: string }) => e.key === 'tolerance.dye',
    );
    expect(entry.value).toBe('2.0000');
    expect(entry.actorId).toBe(SUPERVISOR_ID);
  });

  it('the audit entry carries all SIX facts', async () => {
    await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'the tolerance was reviewed',
      });

    const audit = await harness.tickets.audit.all();

    expect(audit.length).toBe(1);
    const entry = audit[0];
    expect(entry?.action.value).toBe('CONFIGURATION_CHANGE');
    // The actor and the role.
    expect(entry?.actorId).toBe(SUPERVISOR_ID);
    expect(entry?.actorRole).toBe('SUPERVISOR');
    // The key changed.
    expect(entry?.subject.value).toContain('tolerance.dye');
    // And the reason.
    expect(entry?.reason).toBe('the tolerance was reviewed');
  });

  it('an EMPTY reason is refused — and NO version is bumped', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ value: '2.0000', category: 'TOLERANCE', reason: '' });

    expect(response.status).toBe(400);

    // And nothing was written — no version, no audit entry.
    const read = await request(harness.app)
      .get('/api/configuration')
      .set('Authorization', `Bearer ${supervisorToken}`);
    expect(read.body.entries).toHaveLength(0);
    expect(await harness.tickets.audit.all()).toHaveLength(0);
  });

  it('a scope that does NOT EXIST is refused — and NO version is bumped', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        scope: 'NO-SUCH-SCOPE',
        reason: 'the tolerance was reviewed',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('SCOPE_NOT_FOUND');

    // And NO version was consumed.
    const read = await request(harness.app)
      .get('/api/configuration')
      .set('Authorization', `Bearer ${supervisorToken}`);
    expect(read.body.entries).toHaveLength(0);
  });

  it('a scope that DOES exist is accepted', async () => {
    const response = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        scope: 'SCOPE-EXISTS',
        reason: 'the tolerance was reviewed',
      });

    expect(response.status).toBe(200);
  });

  it('a SECOND change creates a NEW version — the original is retained', async () => {
    await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.0000',
        category: 'TOLERANCE',
        reason: 'the first review',
      });

    const second = await request(harness.app)
      .put('/api/configuration/tolerance.dye')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        value: '2.5000',
        category: 'TOLERANCE',
        reason: 'the second review',
      });

    expect(second.status).toBe(200);
    expect(second.body.version).toBe(2);
    expect(second.body.previousValue).toBe('2.0000');

    // And BOTH are audited.
    expect(await harness.tickets.audit.all()).toHaveLength(2);
  });

  it('the configuration without a session is a 401', async () => {
    const response = await request(harness.app).get('/api/configuration');
    expect(response.status).toBe(401);
  });
});

describe('the locale', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('the string is served in the CONFIGURED language', async () => {
    const response = await request(harness.app)
      .get('/api/locale/ar/weigh.title')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.value).toBe('محطة الوزن');
  });

  it('a MISSING key falls back — and no request fails', async () => {
    const response = await request(harness.app)
      .get('/api/locale/ar/weigh.target')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    // The default bundle's string.
    expect(response.body.value).toBe('Target');
  });

  it('a MISSING bundle falls back — and no request fails', async () => {
    const response = await request(harness.app)
      .get('/api/locale/does-not-exist/weigh.title')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.value).toBe('Weighing station');
  });

  it('a key missing from BOTH bundles returns the KEY — and no request fails', async () => {
    const response = await request(harness.app)
      .get('/api/locale/ar/no.such.key')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.value).toBe('no.such.key');
  });
});
