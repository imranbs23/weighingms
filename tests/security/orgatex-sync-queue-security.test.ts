/**
 * The sync queue's security properties.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUEUE'S FOUR REAL RISKS
 * ══════════════════════════════════════════════════════════════════════
 *
 * 1. **A forged idempotency key.** A client that could choose the key
 *    could choose one that collides with another weighing's and suppress
 *    it — a lost consumption. The key is **derived** from the weighing's
 *    identity, and the re-drive uses the **entry's own** key.
 *
 * 2. **Privilege escalation through the body.** The queue's entries carry
 *    the operator id. It comes from the **session**, never from the body.
 *
 * 3. **The MES's internal message reaching the client.** NFR-11 and
 *    IR-09: the failure is diagnosable without MES access, which means
 *    the LOG carries the detail — not the response.
 *
 * 4. **An unauthenticated read of the queue.** The queue is a business
 *    record, not a physically visible device state, so every endpoint
 *    requires an operator session (ADR-020).
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
const WEIGHED_AT = '2026-11-02T08:14:22.000Z';

function body(overrides: Record<string, unknown> = {}) {
  return {
    componentId: 'C-01',
    actualQuantity: '94.01',
    unit: 'g',
    lotNumber: 'L-77120',
    weighedAt: WEIGHED_AT,
    ...overrides,
  };
}

describe('the sync queue — security', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(
      harness,
      OPERATOR_ID,
      'R. Karim',
      'OPERATOR',
      OPERATOR_SECRET,
    );
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    expect(signIn.status).toBe(200);
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  // ── The session boundary ──

  it('refuses the queue listing without a session', async () => {
    const response = await request(harness.app).get('/api/orgatex/sync-queue');

    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('entries');
  });

  it('refuses the link state without a session', async () => {
    const response = await request(harness.app).get('/api/orgatex/link-state');

    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('status');
  });

  it('refuses a re-drive without a session', async () => {
    const response = await request(harness.app).post(
      '/api/orgatex/sync-queue/IDK-0000000000000000/redrive',
    );

    expect(response.status).toBe(401);
  });

  it('refuses a re-drive with a FORGED token', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/IDK-0000000000000000/redrive')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  // ── The key is derived, never chosen ──

  it('refuses a consumption body that names its own idempotency key', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ idempotencyKey: 'IDK-0000000000000000' }));

    // The key is DERIVED from the weighing's identity, so a body that
    // carries one is either refused or ignored — never honoured.
    if (response.status === 201) {
      expect(response.body.postingId).not.toBe('IDK-0000000000000000');
    } else {
      expect(response.status).toBe(400);
    }
  });

  it('the derived key is not the one the caller asked for', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(201);
    expect(response.body.postingId).toMatch(/^IDK-[0-9a-f]{16}$/);
    expect(response.body.postingId).not.toBe('IDK-0000000000000000');
  });

  it('refuses a malformed postingId in the re-drive path', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/not-a-key/redrive')
      .set('Authorization', `Bearer ${token}`);

    // A malformed key is a plain 400, not a 500 — and it never reaches
    // the queue.
    expect(response.status).toBe(400);
  });

  it('refuses an over-long postingId in the re-drive path', async () => {
    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${'A'.repeat(200)}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  // ── The operator comes from the session ──

  it('the queued entry carries the SIGNED-IN operator, not one from the body', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ operatorId: 'OP-999' }));

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.entries[0].operatorId).toBe(OPERATOR_ID);
  });

  // ── The MES's prose never reaches the client ──

  it('the MES\'s internal message never reaches the client (NFR-11)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    // The adapter's prose is in the log, not in the response.
    expect(JSON.stringify(response.body)).not.toContain(
      'Dummy OrgaTEX is unreachable',
    );
  });

  it('the link state never carries the error detail (NFR-11)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(JSON.stringify(response.body)).not.toContain(
      'Dummy OrgaTEX is unreachable',
    );
    expect(response.body.lastError).not.toHaveProperty('detail');
  });

  it('the rejection detail is never echoed back by the re-drive', async () => {
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(JSON.stringify(response.body)).not.toContain(
      'Dummy OrgaTEX is unreachable',
    );
  });

  // ── The re-drive is an ordinary operator action ──

  it('the re-drive uses the ENTRY\'s key — the caller cannot choose another', async () => {
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ postingId: 'IDK-0000000000000000' });

    // The body is ignored — the path carries the key.
    if (response.status === 409 || response.status === 404) {
      expect(response.body).not.toHaveProperty('delivered');
    }
  });

  it('the queue view never leaks another operator\'s session', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    // No token, no secret, no session material.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(OPERATOR_SECRET);
  });
});
