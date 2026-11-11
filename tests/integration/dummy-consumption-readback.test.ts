/**
 * The Dummy OrgaTEX's stored consumption, read back — unit 005, bolt 033.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THE MES RECEIVED, AS RECEIVED — DUPLICATES INCLUDED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A training contract (workbook Step 26), not a claim about the real
 * OrgaTEX interface (A-01, Q-01).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the Dummy OrgaTEX consumption read-back (bolt 033)', () => {
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

  beforeEach(async () => {
    harness = createHarness({ sampleIntervalMs: 20 });
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('is an EMPTY list for a batch with nothing posted — not an error', async () => {
    const response = await request(harness.app).get('/api/batches/B-24187/consumption');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ batchId: 'B-24187', receivedCount: 0, postings: [] });
  });

  it('is a 404 for a batch the MES does not know', async () => {
    const response = await request(harness.app).get('/api/batches/B-99999/consumption');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('BATCH_NOT_FOUND');
  });

  it('is a 503 while the MES is unreachable', async () => {
    await api('post', '/api/orgatex/control').send({ state: 'UNREACHABLE' });

    const response = await request(harness.app).get('/api/batches/B-24187/consumption');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('ORGATEX_UNAVAILABLE');
  });

  it('lists the FIVE postings the station made when B-24187 completed — each as received', async () => {
    await api('get', '/api/recipe/B-24187');
    await api('post', '/api/session/start').send({ batchId: 'B-24187' });
    for (let index = 0; index < 5; index += 1) {
      const active = (await api('get', '/api/session')).body.session.activeComponentId as string;
      await api('post', '/api/session/training/dispense').send({ landing: 'IN_TOLERANCE' });
      await zoneBecomes('OK');
      expect((await api('post', '/api/session/confirm').send({ componentId: active })).status).toBe(201);
    }
    const completed = await api('post', '/api/batch/B-24187/complete');
    expect(completed.body.summary.writeBack).toBe('CONFIRMED');

    const response = await request(harness.app).get('/api/batches/B-24187/consumption');

    expect(response.status).toBe(200);
    expect(response.body.receivedCount).toBe(5);
    const postings = response.body.postings as Record<string, string>[];
    expect(postings.map((p) => p['componentId'])).toEqual([
      'DYE-4471-B', 'DYE-2204-R', 'DYE-4471-Y', 'AUX-0101', 'AUX-0107',
    ]);
    for (const posting of postings) {
      expect(posting['batchId']).toBe('B-24187');
      expect(posting['operatorId']).toBe(OPERATOR_ID);
      expect(typeof posting['actualQuantity']).toBe('string');
      expect(posting['idempotencyKey']).toBeTruthy();
      expect(posting['weighedAt']).toBeTruthy();
    }
    // The MES's own lots arrived as SOURCE for the three dyes (bolt 031).
    expect(postings[0]?.['lotNumber']).toBe('2026-0341');
  });

  it('shows a DUPLICATE posting twice — the MES does not hide it', async () => {
    const posting = {
      batchId: 'B-24188',
      componentId: 'DYE-4471-B',
      actualQuantity: '1241.5000',
      unit: 'g',
      lotNumber: '2026-0341',
      operatorId: OPERATOR_ID,
      weighedAt: '2026-11-11T09:00:00.000Z',
      idempotencyKey: 'TRAINING-DUPLICATE-1',
    };
    for (let index = 0; index < 2; index += 1) {
      const posted = await request(harness.app)
        .post('/api/batches/B-24188/consumption')
        .send(posting);
      expect(posted.status).toBe(201);
    }

    const response = await request(harness.app).get('/api/batches/B-24188/consumption');

    expect(response.body.receivedCount).toBe(2);
    expect(response.body.postings[0]).toEqual(posting);
    expect(response.body.postings[1]).toEqual(posting);
  });
});
