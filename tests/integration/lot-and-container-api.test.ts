/**
 * The lot and the container on the weighing — bolt 031.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS SESSION'S LOT AND CONTAINER ARE SHOWN AND RECORDED. NO OTHER'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test, against the real station and unit 002:
 *
 *   - the MES's lot is retrieved when the component is prepared (SOURCE)
 *   - a keyed lot and a master-tare container appear on the session
 *   - the confirmed record carries them
 *   - an empty lot and an unknown container are refused, and record nothing
 *   - a capture from an EARLIER session is neither shown nor recorded
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the lot and the container (bolt 031)', () => {
  let harness: Harness;
  let token: string;

  const api = (method: 'get' | 'post', path: string) =>
    request(harness.app)[method](path).set('Authorization', `Bearer ${token}`);

  async function zoneBecomes(wanted: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const zone = await api('get', '/api/session/zone');
      if (zone.body.zone === wanted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`the zone never became ${wanted}`);
  }

  async function snapshot(): Promise<{
    activeComponentId: string;
    activeCaptures: {
      lot: { lotNumber: string; method: string } | null;
      container: { containerId: string; tareWeight: string; tareUnit: string; tareSource: string } | null;
    };
  }> {
    return (await api('get', '/api/session')).body.session;
  }

  async function pourAndConfirm(): Promise<request.Response> {
    const active = (await snapshot()).activeComponentId;
    await api('post', '/api/session/training/dispense').send({ landing: 'IN_TOLERANCE' });
    await zoneBecomes('OK');
    return api('post', '/api/session/confirm').send({ componentId: active });
  }

  beforeEach(async () => {
    harness = createHarness({ sampleIntervalMs: 20 });
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
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

  it('retrieves the MES’s lot when the component is prepared — method SOURCE', async () => {
    const session = await snapshot();

    expect(session.activeComponentId).toBe('DYE-4471-B');
    expect(session.activeCaptures.lot).toEqual({ lotNumber: '2026-0341', method: 'SOURCE' });
    expect(session.activeCaptures.container).toBeNull();
  });

  it('a master-tare container shows with its tare, and the record carries lot and container', async () => {
    const assigned = await api('post', '/api/container').send({
      componentId: 'DYE-4471-B',
      containerId: 'C-09',
      scaleId: 'SCALE-A',
    });
    expect(assigned.status).toBe(201);

    const session = await snapshot();
    expect(session.activeCaptures.container).toMatchObject({
      containerId: 'C-09',
      tareUnit: 'g',
      tareSource: 'CONTAINER_MASTER',
    });
    expect(Number(session.activeCaptures.container?.tareWeight)).toBe(214);

    const confirmed = await pourAndConfirm();
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.record.lotNumber).toBe('2026-0341');
    expect(confirmed.body.record.containerId).toBe('C-09');
    // THE TARE IT USED — on the record itself (bolt 032, ADR-048).
    expect(confirmed.body.record.tare).toEqual({
      weight: session.activeCaptures.container?.tareWeight,
      unit: 'g',
      source: 'CONTAINER_MASTER',
    });
  });

  it('a KEYED lot for a component the MES holds none for is captured and recorded', async () => {
    // Weigh the three dyes, to reach Sodium Sulphate (no MES lot).
    for (let index = 0; index < 3; index += 1) {
      expect((await pourAndConfirm()).status).toBe(201);
    }
    let session = await snapshot();
    expect(session.activeComponentId).toBe('AUX-0101');
    expect(session.activeCaptures.lot).toBeNull();

    const captured = await api('post', '/api/material-lot').send({
      componentId: 'AUX-0101',
      lotNumber: '2026-0112',
    });
    expect(captured.status).toBe(201);
    session = await snapshot();
    expect(session.activeCaptures.lot).toEqual({ lotNumber: '2026-0112', method: 'KEYED_IN' });

    const confirmed = await pourAndConfirm();
    expect(confirmed.body.record.lotNumber).toBe('2026-0112');
    expect(confirmed.body.record.containerId).toBeNull();
    // No container, no tare — never invented (ADR-048).
    expect(confirmed.body.record.tare).toBeNull();
  });

  it('an EMPTY lot is refused, and nothing is captured', async () => {
    // Move to a component with no MES lot, so "nothing captured" is visible.
    for (let index = 0; index < 3; index += 1) await pourAndConfirm();

    const refused = await api('post', '/api/material-lot').send({
      componentId: 'AUX-0101',
      lotNumber: '   ',
    });

    expect(refused.status).toBe(400);
    expect((await snapshot()).activeCaptures.lot).toBeNull();
  });

  it('an UNKNOWN container is refused, and nothing is assigned', async () => {
    const refused = await api('post', '/api/container').send({
      componentId: 'DYE-4471-B',
      containerId: 'X-99',
      scaleId: 'SCALE-A',
    });

    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe('CONTAINER_NOT_FOUND');
    expect((await snapshot()).activeCaptures.container).toBeNull();
  });

  it('a capture from an EARLIER session is neither shown nor recorded', async () => {
    // The first session: a keyed container for Blue, then the whole batch.
    await api('post', '/api/container').send({
      componentId: 'DYE-4471-B',
      containerId: 'C-09',
      scaleId: 'SCALE-A',
    });
    for (let index = 0; index < 5; index += 1) {
      expect((await pourAndConfirm()).status).toBe(201);
    }
    expect((await api('post', '/api/batch/B-24187/complete')).status).toBe(200);

    // A NEW session for the same batch — the old container is not its own.
    harness.clock.advance(60_000);
    await api('get', '/api/recipe/B-24187');
    await api('post', '/api/session/start').send({ batchId: 'B-24187' });
    const session = await snapshot();
    expect(session.activeComponentId).toBe('DYE-4471-B');
    expect(session.activeCaptures.container).toBeNull();

    const confirmed = await pourAndConfirm();
    expect(confirmed.body.record.containerId).toBeNull();
    expect(confirmed.body.record.tare).toBeNull();
  });
});
