/**
 * The overshoot rule — unit 003, bolt 030 (workbook Step 24, ADR-047).
 *
 * ══════════════════════════════════════════════════════════════════════
 * OVER IS CONFIRMED ONLY THROUGH A SCOPED, SINGLE-USE SUPERVISOR OVERRIDE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test, against the real station and unit 008:
 *
 *   - OVER is refused without an override
 *   - a COMPENSABLE over-dose (not the last component) can be escalated
 *   - the supervisor authorises at the terminal; the record keeps the
 *     POURED quantity with zone OVER, and an override record is written
 *   - the override is single-use, scoped to its component, and bounded by
 *     the weight the supervisor saw
 *   - a wrong PIN, or the operator as supervisor, is refused uniformly
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';
const SUPERVISOR_ID = 'SUP-001';
const SUPERVISOR_SECRET = '9164';

describe('the overshoot rule (ADR-047)', () => {
  let harness: Harness;
  let token: string;

  const api = (method: 'get' | 'post', path: string) =>
    request(harness.app)[method](path).set('Authorization', `Bearer ${token}`);

  /** Wait until the API's zone is the one wanted. */
  async function zoneBecomes(wanted: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const zone = await api('get', '/api/session/zone');
      if (zone.body.zone === wanted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`the zone never became ${wanted}`);
  }

  /** Wait until the reading stops moving, and return it. */
  async function settledWeight(): Promise<{ value: string; unit: string }> {
    let previous = '';
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const zone = await api('get', '/api/session/zone');
      if (zone.body.value === previous) {
        return { value: zone.body.value as string, unit: zone.body.unit as string };
      }
      previous = zone.body.value as string;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('the reading never settled');
  }

  async function activeComponent(): Promise<string> {
    const session = await api('get', '/api/session');
    return session.body.session.activeComponentId as string;
  }

  /** Pour the active component over tolerance, and let it come to rest. */
  async function overPour(): Promise<{ value: string; unit: string }> {
    await api('post', '/api/session/training/dispense').send({
      landing: 'OVER_TOLERANCE',
    });
    await zoneBecomes('OVER');
    return settledWeight();
  }

  /** The supervisor authenticates for a subject; unit 008 answers. */
  function supervisorAuthorises(
    subject: string,
    supervisorId = SUPERVISOR_ID,
    secret = SUPERVISOR_SECRET,
  ): request.Test {
    return api('post', '/api/identity/authorisations').send({
      supervisorId,
      secret,
      action: 'CONFIRM_COMPONENT',
      subject,
      reason: 'Client accepts the stronger shade',
    });
  }

  /** Raise the escalation and have SUP-001 authorise it. */
  async function overrideActive(): Promise<string> {
    const component = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: component });
    expect(raised.status).toBe(201);

    const granted = await supervisorAuthorises(raised.body.escalation.subject as string);
    expect(granted.status).toBe(201);

    const authorised = await api('post', '/api/escalation/authorise').send({
      authorisationId: granted.body.authorisationId,
      supervisorId: SUPERVISOR_ID,
      secret: SUPERVISOR_SECRET,
      reason: 'Client accepts the stronger shade',
    });
    expect(authorised.status).toBe(200);
    expect(authorised.body.escalation.state).toBe('AUTHORISED');
    return granted.body.authorisationId as string;
  }

  beforeEach(async () => {
    harness = createHarness({ sampleIntervalMs: 20 });
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    await seedOperator(harness, SUPERVISOR_ID, 'S. Ahmed', 'SUPERVISOR', SUPERVISOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;

    await api('get', '/api/recipe/B-24187');
    await api('post', '/api/session/start').send({ batchId: 'B-24187' });
  });

  afterEach(() => {
    harness.close();
  });

  it('OVER is REFUSED without an override — never confirmed automatically', async () => {
    await overPour();
    const component = await activeComponent();

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });

    expect(confirmed.status).toBe(409);
    expect(confirmed.body.reason).toBe('ZONE_OVER');
  });

  it('a COMPENSABLE over-dose (the FIRST component, others remain) can be escalated, with its subject', async () => {
    await overPour();
    const component = await activeComponent();
    expect(component).toBe('DYE-4471-B');

    const raised = await api('post', '/api/escalation').send({ componentId: component });

    expect(raised.status).toBe(201);
    expect(raised.body.escalation.state).toBe('ESCALATED');
    expect(raised.body.escalation.subject).toBe(
      `${raised.body.escalation.sessionId as string}/DYE-4471-B`,
    );
  });

  it('raising an override when the weight is NOT over is refused', async () => {
    const component = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: component });

    expect(raised.status).toBe(409);
    expect(raised.body.error).toBe('NOT_ESCALATABLE');
    expect(raised.body.reason).toBe('NOT_OVER');
  });

  it('with the supervisor’s override, OVER is confirmed AS POURED, zone OVER, with an override record', async () => {
    const poured = await overPour();
    const component = await activeComponent();
    await overrideActive();

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });

    expect(confirmed.status).toBe(201);
    expect(confirmed.body.record.zoneAtConfirm).toBe('OVER');
    // THE POURED QUANTITY — never adjusted to the target.
    expect(confirmed.body.record.actualQuantity).toBe(poured.value);
    expect(confirmed.body.record.unit).toBe(poured.unit);
    // No recipe is recalculated: the batch simply moves on.
    expect(confirmed.body.advancedTo).toBe('DYE-2204-R');

    const override = await harness.station.overrides.latestFor(ComponentId.create(component));
    expect(override).not.toBeNull();
    expect(override?.supervisorId).toBe(SUPERVISOR_ID);
    expect(override?.operatorId).toBe(OPERATOR_ID);
    expect(override?.reason).toBe('Client accepts the stronger shade');

    // THE OVERRIDE IS SPENT — the escalation is cleared.
    const after = await api('get', `/api/escalation/${component}`);
    expect(after.body.escalation).toBeNull();
  });

  it('a WRONG PIN is refused uniformly — and OVER stays unconfirmed', async () => {
    await overPour();
    const component = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: component });

    const granted = await supervisorAuthorises(
      raised.body.escalation.subject as string,
      SUPERVISOR_ID,
      '0000',
    );
    expect(granted.status).toBe(403);
    expect(granted.body).toEqual({ error: 'AUTHORISATION_REFUSED' });

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.reason).toBe('ZONE_OVER');
  });

  it('the OPERATOR cannot authorise their own override — the same uniform refusal', async () => {
    await overPour();
    const component = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: component });

    const granted = await supervisorAuthorises(
      raised.body.escalation.subject as string,
      OPERATOR_ID,
      OPERATOR_SECRET,
    );

    expect(granted.status).toBe(403);
    expect(granted.body).toEqual({ error: 'AUTHORISATION_REFUSED' });
  });

  it('an authorisation issued for ANOTHER component is refused by the escalation', async () => {
    await overPour();
    const component = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: component });
    const sessionId = raised.body.escalation.sessionId as string;

    const granted = await supervisorAuthorises(`${sessionId}/DYE-2204-R`);
    expect(granted.status).toBe(201);

    const authorised = await api('post', '/api/escalation/authorise').send({
      authorisationId: granted.body.authorisationId,
      supervisorId: SUPERVISOR_ID,
      secret: SUPERVISOR_SECRET,
      reason: 'Client accepts the stronger shade',
    });
    expect(authorised.status).toBe(403);
    expect(authorised.body).toEqual({ error: 'AUTHORISATION_REFUSED' });

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });
    expect(confirmed.status).toBe(409);
  });

  it('a USED authorisation cannot open the gate a second time', async () => {
    await overPour();
    const first = await activeComponent();
    const authorisationId = await overrideActive();
    const confirmed = await api('post', '/api/session/confirm').send({ componentId: first });
    expect(confirmed.status).toBe(201);

    // The next component, over-dosed too — the old id is presented again.
    await overPour();
    const second = await activeComponent();
    const raised = await api('post', '/api/escalation').send({ componentId: second });
    expect(raised.status).toBe(201);

    const reused = await api('post', '/api/escalation/authorise').send({
      authorisationId,
      supervisorId: SUPERVISOR_ID,
      secret: SUPERVISOR_SECRET,
      reason: 'Client accepts the stronger shade',
    });
    expect(reused.status).toBe(403);

    const refused = await api('post', '/api/session/confirm').send({ componentId: second });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('ZONE_OVER');
  });

  it('a pour HEAVIER than the authorised weight needs a new authorisation', async () => {
    const poured = await overPour();
    const component = await activeComponent();
    await overrideActive();

    // Pour on: the platform ramps past the weight the supervisor saw.
    const heavier = (Number(poured.value) + 5).toFixed(4);
    await api('post', '/api/scales/SCALE-A/dispense').send({
      target: heavier,
      tolerance: '0.0001',
      landing: 'IN_TOLERANCE',
    });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const zone = await api('get', '/api/session/zone');
      if (Number(zone.body.value) > Number(poured.value)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });

    expect(confirmed.status).toBe(409);
    expect(confirmed.body.reason).toBe('ZONE_OVER');
  });

  it('a re-tare back INTO tolerance takes the ordinary path, and the unused override is cleared', async () => {
    await overPour();
    const component = await activeComponent();
    await overrideActive();

    await api('post', '/api/scales/SCALE-A/re-tare');
    await api('post', '/api/session/training/dispense').send({ landing: 'IN_TOLERANCE' });
    await zoneBecomes('OK');

    const confirmed = await api('post', '/api/session/confirm').send({ componentId: component });

    expect(confirmed.status).toBe(201);
    expect(confirmed.body.record.zoneAtConfirm).toBe('OK');
    const after = await api('get', `/api/escalation/${component}`);
    expect(after.body.escalation).toBeNull();
  });
});
