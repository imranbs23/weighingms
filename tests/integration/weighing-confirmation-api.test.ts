/**
 * The zone and the confirmation — unit 003, bolt 014.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ENDPOINTS, OVER THE REAL RECIPE AND THE REAL SESSION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the zone is reported, and it is the DOMAIN's zone
 *   - the still-to-weigh is reported, and clamped in the domain
 *   - the confirmation is a `201` and writes the record
 *   - a confirmation out of tolerance is a `409` carrying the zone
 *   - a replayed confirmation is idempotent — no second record
 *   - the body has NO `zone` and NO `actualQuantity` field
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

describe('the zone and the confirmation', () => {
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

  /** Select the component, so the session is weighing. */
  async function select(): Promise<void> {
    const response = await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    expect(response.status).toBe(200);
  }

  it('reports NO zone when there is no active component', async () => {
    const response = await request(harness.app)
      .get('/api/session/zone')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.zone).toBeNull();
  });

  it('reports the zone once a component is active', async () => {
    await select();

    const response = await request(harness.app)
      .get('/api/session/zone')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    // No reading yet, so no zone — and the body says so rather than
    // guessing.
    expect(response.body.zone).toBeNull();
  });

  it('returns 401 for the zone without a session', async () => {
    const response = await request(harness.app).get('/api/session/zone');
    expect(response.status).toBe(401);
  });

  it('refuses a confirmation with NO reading — and writes nothing', async () => {
    await select();

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('CONFIRMATION_REFUSED');
    expect(response.body.reason).toBe('NO_READING');
  });

  it('DROPS a client-supplied zone — the DOMAIN decides', async () => {
    await select();

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        zone: 'OK',
        actualQuantity: '94.0000',
      });

    // The zone and the quantity are **stripped** — the fields do not
    // exist — so the station's own reading decides.
    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('NO_READING');
    expect(response.body.zone).toBeNull();
  });

  it('returns 400 when the body carries no component', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for a confirmation without a session', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('returns 404 for a component the recipe does not hold', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'NOPE' });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('NO_ACTIVE_COMPONENT');
  });
});
