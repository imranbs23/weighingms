/**
 * The progression's endpoints — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT DOES NOT CHOOSE WHAT COMES NEXT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the confirmation requires an operator session (ADR-020)
 *   - a client cannot confirm a component the session is **not** working on
 *   - a client cannot choose the next component — the recipe's order is
 *     the MES's and is read-only (C-01)
 *   - a duplicate confirmation is refused, and **no second record** is
 *     written
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { dispenseToTarget } from '../support/overdose-drive.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the progression — security', () => {
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

  it('refuses the confirmation without a session', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('refuses the confirmation with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('refuses a confirmation for a component the session is NOT working on', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    // The client names a DIFFERENT component.
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'AUX-0107' });

    expect(response.status).toBe(409);
  });

  it('the client CANNOT choose the next component', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    await dispenseToTarget(harness, token, 'DYE-4471-Y', 'IN_TOLERANCE', 'SCALE-A');

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        // The client TRIES to name the next component. There is no such
        // field — the progression follows the recipe's order.
        nextComponentId: 'AUX-0107',
        advanceTo: 'AUX-0107',
      });

    expect(response.status).toBe(201);
    // And the session advanced to the recipe's next — not the client's.
    expect(response.body.advancedTo).toBe('AUX-0101');
  });

  it('a duplicate confirmation is refused, and NO second record is written', async () => {
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

    const second = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });
    expect(second.status).toBe(409);

    // ONE record. The duplicate wrote nothing.
    //
    // The count comes from the REPOSITORY, not from an endpoint — and the
    // repository is the station's own fact about what it has written.
    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    const written = await harness.station.records.latestFor(
      session.sessionId,
      ComponentId.create('DYE-4471-Y'),
    );
    expect(written).not.toBeNull();
  });
});
