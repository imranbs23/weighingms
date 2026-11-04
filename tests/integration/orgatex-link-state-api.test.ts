/**
 * The link state's HTTP surface (R-03, R-04).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LINK STATE IS DATA, AND IT IS NEVER GUESSED
 * ══════════════════════════════════════════════════════════════════════
 *
 * The endpoint reports a **derived** state — `LINKED`, `DEGRADED` or
 * `OFFLINE` — together with the observations it was derived from. What it
 * must never do is report a state that the observations do not support:
 * a guessed link state is an operator being told the MES is up when it is
 * not, and that is the failure this whole bolt exists to prevent.
 *
 * The `unsynchronisedCount` is the queue's depth. It is reported in
 * **every** state, because a healthy link with a non-empty queue is a
 * fact the operator needs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';

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

describe('the link state endpoint', () => {
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

  // ── The session requirement ──

  it('refuses the link state without a session', async () => {
    const response = await request(harness.app).get('/api/orgatex/link-state');

    expect(response.status).toBe(401);
  });

  // ── R-03 — the shape of the answer ──

  it('reports the state, the observations and the count (R-03, R-04)', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('lastContactAt');
    expect(response.body).toHaveProperty('lastError');
    expect(response.body).toHaveProperty('consecutiveFailures');
    expect(response.body).toHaveProperty('unsynchronisedCount');
  });

  it('a station that has NEVER contacted the MES is OFFLINE', async () => {
    // Nothing has contacted the MES, so there is no last success, and
    // `DEGRADED` requires one. The state is OFFLINE — not LINKED, and
    // not a guess.
    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('OFFLINE');
    expect(response.body.lastContactAt).toBeNull();
    expect(response.body.lastError).toBeNull();
    expect(response.body.consecutiveFailures).toBe(0);
  });

  it('a successful contact makes the link LINKED', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('LINKED');
    expect(response.body.consecutiveFailures).toBe(0);
    expect(response.body.lastError).toBeNull();
    expect(response.body.lastContactAt).not.toBeNull();
  });

  it('a failed contact makes the link DEGRADED, with the error', async () => {
    // A successful contact FIRST — `DEGRADED` means "the link worked and
    // then stopped", so it REQUIRES a last successful contact.
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:15:00.000Z' }));

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('DEGRADED');
    expect(response.body.consecutiveFailures).toBe(1);
    expect(response.body.lastError).not.toBeNull();
    expect(response.body.lastError.code).toBe('UNREACHABLE');
  });

  it('the error carries a CODE and a summary — never the raw detail (NFR-11)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    // The detail goes to the log, never to the client.
    expect(response.body.lastError).toHaveProperty('code');
    expect(response.body.lastError).toHaveProperty('summary');
    expect(response.body.lastError).not.toHaveProperty('detail');
  });

  it('the failure streak is counted (R-03)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:15:00.000Z' }));

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.consecutiveFailures).toBe(1);
  });

  it('a success RESETS the failure streak', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    harness.orgatex.world.setReachable(true);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:16:00.000Z' }));

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('LINKED');
    expect(response.body.consecutiveFailures).toBe(0);
    expect(response.body.lastError).toBeNull();
  });

  // ── R-04 — the un-synchronised count ──

  it('the count is zero when nothing is queued', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.unsynchronisedCount).toBe(0);
  });

  it('the count reports the consumptions that have not landed (R-04)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:15:00.000Z' }));

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.unsynchronisedCount).toBe(2);
  });

  it('the count is reported even while the link is HEALTHY (R-04)', async () => {
    // A healthy link with a non-empty queue is a fact the operator needs,
    // so the count is in every state — not only in the degraded ones.
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    harness.orgatex.world.setReachable(true);

    // A DIFFERENT weighing — the key is derived from the weighing's
    // identity, so this is a distinct consumption, not a duplicate.
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:16:00.000Z' }));

    const response = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('LINKED');
    expect(response.body.unsynchronisedCount).toBe(1);
  });
});
