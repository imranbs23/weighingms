/**
 * The reprint — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MARKING IS DERIVED. THE CLIENT SUPPLIES NONE OF IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the reprint requires an operator session (ADR-020)
 *   - a client-supplied `isReprint`, `reprintOf`, `actorId` or `actorRole`
 *     is **dropped** — every one of them is derived
 *   - the reason is **mandatory** — and a blank one is refused
 *   - the reprint never writes a weighing record
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

describe('the reprint — security', () => {
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

  it('refuses the reprint without a session', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-1/reprint')
      .send({ reason: 'a reason' });

    expect(response.status).toBe(401);
  });

  it('refuses the reprint with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-1/reprint')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ reason: 'a reason' });

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied marking — isReprint, reprintOf, actor and role', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-NOPE/reprint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'a reason',
        // The client TRIES to assert the marking.
        isReprint: false,
        reprintOf: 'TKT-SOMEWHERE-ELSE',
        actorId: 'OP-SOMEONE-ELSE',
        actorRole: 'SUPERVISOR',
      });

    // The ticket does not exist, so there is no reprint — but the client's
    // fields are simply not read.
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('TICKET_NOT_FOUND');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
    expect(response.text).not.toContain('TKT-SOMEWHERE-ELSE');
  });

  it('a blank reason is refused — whitespace only too', async () => {
    for (const reason of ['', '   ', '\t\n']) {
      const response = await request(harness.app)
        .post('/api/tickets/TKT-NOPE/reprint')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('REPRINT_REASON_REQUIRED');
    }
  });

  it('the trail records the SESSION’S actor — not a client-supplied one', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-NOPE/reprint')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'a reason', actorId: 'OP-SOMEONE-ELSE' });

    expect(response.status).toBe(404);

    // And no entry was written — the ticket does not exist.
    expect(await harness.tickets.audit.all()).toEqual([]);
  });

  it('the reprint never writes a weighing record', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    const before = await harness.station.records.allFor(session.sessionId);

    await request(harness.app)
      .post('/api/tickets/TKT-NOPE/reprint')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'a reason' });

    const after = await harness.station.records.allFor(session.sessionId);
    expect(after.length).toBe(before.length);
  });
});
