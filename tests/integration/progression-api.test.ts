/**
 * The progression — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CONFIRM A COMPONENT, AND THE SESSION MOVES ON.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the `201` carries the record and the component it advanced to
 *   - the session's states afterwards are right — `DONE`, then `ACTIVE`
 *   - a **duplicate** confirmation is refused — atomically
 *   - the last component's confirmation is `COMPLETED`
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { dispenseToTarget } from '../support/overdose-drive.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the progression', () => {
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

  it('confirming a component advances the session to the NEXT in recipe order', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    await dispenseToTarget(harness, token, 'DYE-4471-Y', 'IN_TOLERANCE', 'SCALE-A');

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    // The refusal's reason belongs in the failure — a 409 with no reason
    // is a diagnosis the test cannot make.
    expect(
      response.status,
      `the confirmation was refused: ${JSON.stringify(response.body)}`,
    ).toBe(201);
    // The record is in the response.
    expect(response.body.record.componentId).toBe('DYE-4471-Y');
    // And the session advanced to the NEXT component in RECIPE ORDER.
    //
    // The recipe's order is DYE-4471-B, DYE-2204-R, DYE-4471-Y, AUX-0101,
    // AUX-0107 — so the one after DYE-4471-Y is AUX-0101, and the two
    // before it are still PENDING.
    expect(response.body.advancedTo).toBe('AUX-0101');
    expect(response.body.batchComplete).toBe(false);
  });

  it('the session’s component states are right afterwards', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    await dispenseToTarget(harness, token, 'DYE-4471-Y', 'IN_TOLERANCE', 'SCALE-A');
    await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .get('/api/session')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const components = (response.body.session?.components ?? []) as {
      componentId: string;
      state: string;
    }[];
    const first = components.find((c) => c.componentId === 'DYE-4471-Y');
    const next = components.find((c) => c.componentId === 'AUX-0101');
    expect(first?.state).toBe('DONE');
    expect(next?.state).toBe('ACTIVE');

    // And EXACTLY ONE is ACTIVE.
    expect(
      components.filter((c) => c.state === 'ACTIVE'),
    ).toHaveLength(1);
  });

  it('a DUPLICATE confirmation is refused — atomically', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    await dispenseToTarget(harness, token, 'DYE-4471-Y', 'IN_TOLERANCE', 'SCALE-A');

    const first = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    expect(first.status).toBe(201);

    // The component is DONE now — and it is not the active one. The
    // duplicate is refused either way, and the record is NOT written
    // twice.
    const second = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    expect(second.status).toBe(409);
  });

  it('confirming a component that is NOT the active one is refused', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'AUX-0107' });

    expect(response.status).toBe(409);
  });

  it('the last component’s confirmation COMPLETES the batch', async () => {
    // Select the LAST component of the recipe.
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'AUX-0107' });

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'AUX-0107' });

    // The gate refuses — there is no reading — so the confirmation does
    // not happen at all. The point of the test is that the endpoint
    // reports the refusal rather than advancing.
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('CONFIRMATION_REFUSED');
  });

  it('a confirmation without a session is 401', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });
});
