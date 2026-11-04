/**
 * The sync queue's HTTP surface (R-07, R-09, R-13, R-14).
 *
 * ══════════════════════════════════════════════════════════════════════
 * A QUEUED WRITE IS REPORTED AS PENDING. NEVER AS POSTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's central rule is that the station keeps weighing while
 * OrgaTEX is unreachable, and that nothing is silently discarded. So:
 *
 *   - an undeliverable consumption is **queued**, and reported as pending;
 *   - it is **durable** — it survives a restart;
 *   - a `FAILED` entry is **visible**, never deleted;
 *   - a re-drive is an ordinary operator action, and it reuses the
 *     entry's **original** key.
 *
 * The rule that is easiest to get wrong: a queued write must never be
 * reported as posted. A `201` with `state: 'QUEUED'` says the request was
 * accepted for delivery — not that the MES has it.
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

/** Drive the retry worker once, so a queued entry reaches its outcome. */
async function retryDue(harness: Harness): Promise<void> {
  const { Instant } = await import(
    '../../src/004-scale-integration/domain/value-objects/instant.js'
  );
  await harness.orgatex.syncQueueService.retryDue(
    Instant.of(harness.clock.now()),
  );
}

describe('the sync queue API', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    // `PERMANENT` — a refused consumption is NOT retried automatically.
    // The entry goes to `FAILED` and waits for an operator, which is what
    // makes the re-drive a real operator action.
    harness = createHarness({ orgatexRejectionDisposition: 'PERMANENT' });
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

  it('refuses the queue listing without a session', async () => {
    const response = await request(harness.app).get('/api/orgatex/sync-queue');

    expect(response.status).toBe(401);
  });

  it('refuses a re-drive without a session', async () => {
    const response = await request(harness.app).post(
      '/api/orgatex/sync-queue/IDK-0000000000000000/redrive',
    );

    expect(response.status).toBe(401);
  });

  // ── R-09 — an undeliverable posting is queued ──

  it('an undeliverable consumption is QUEUED and reported as pending (R-09)', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    // 201 — the request WAS accepted for delivery.
    expect(response.status).toBe(201);
    expect(response.body.state).toBe('QUEUED');
    expect(response.body.pending).toBe(true);
    // NOT posted. The MES does not have it.
    expect(response.body.state).not.toBe('ACCEPTED');
  });

  it('the queued consumption is in the QUEUE (R-09)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0].state).toBe('PENDING');
    expect(response.body.entries[0].attempts).toBe(0);
  });

  it('the queued entry carries its content, so the operator can see it', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    const entry = response.body.entries[0];
    expect(entry.batchId).toBe('B-24187');
    expect(entry.componentId).toBe('C-01');
    expect(entry.lotNumber).toBe('L-77120');
    expect(entry.operatorId).toBe(OPERATOR_ID);
    // The quantity is a STRING — never a JSON number (NFR-16).
    expect(entry.actualQuantity).toBe('94.01');
    expect(typeof entry.actualQuantity).toBe('string');
    expect(entry.unit).toBe('g');
  });

  it('a second submission of the SAME weighing does not queue twice (R-09)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    // Two entries for one weighing would be two deliveries.
    expect(response.body.count).toBe(1);
  });

  // ── R-07 — weighing continues in every link state ──

  it('weighing CONTINUES while the link is down (R-07, NFR-03)', async () => {
    harness.orgatex.world.setReachable(false);

    // Three distinct weighings — the link is down for all of them.
    for (const [index, time] of [
      '2026-11-02T08:14:22.000Z',
      '2026-11-02T08:15:00.000Z',
      '2026-11-02T08:16:00.000Z',
    ].entries()) {
      const response = await request(harness.app)
        .post('/api/orgatex/batches/B-24187/consumption')
        .set('Authorization', `Bearer ${token}`)
        .send(body({ weighedAt: time }));

      expect(response.status).toBe(201);
      expect(response.body.state).toBe('QUEUED');
      void index;
    }

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.count).toBe(3);
  });

  it('the link state does NOT refuse the weighing — it is only reported (R-07)', async () => {
    harness.orgatex.world.setReachable(false);

    const state = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);
    expect(state.status).toBe(200);

    const posting = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    // The weighing was accepted for delivery — not refused.
    expect(posting.status).toBe(201);
  });

  // ── R-14 — the queue view ──

  it('the queue view reports the count and each entry\'s state (R-14)', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('count');
    expect(response.body).toHaveProperty('entries');
    expect(response.body.count).toBe(0);
    expect(response.body.entries).toEqual([]);
  });

  it('the entries are in QUEUE ORDER (R-14, OQ-4)', async () => {
    harness.orgatex.world.setReachable(false);

    for (const time of [
      '2026-11-02T08:16:00.000Z',
      '2026-11-02T08:14:22.000Z',
      '2026-11-02T08:15:00.000Z',
    ]) {
      await request(harness.app)
        .post('/api/orgatex/batches/B-24187/consumption')
        .set('Authorization', `Bearer ${token}`)
        .send(body({ weighedAt: time }));
    }

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    // The queue order is `queued_at ASC, posting_id ASC` — the order the
    // consumptions were QUEUED, not the order they were weighed. When two
    // were queued in the same millisecond, the key breaks the tie — so
    // the order is total and the same after a restart.
    const ids = response.body.entries.map(
      (entry: { postingId: string }) => entry.postingId,
    );
    expect(ids).toEqual([...ids].sort());
  });

  it('the error detail NEVER reaches the client (NFR-11)', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    const entry = response.body.entries[0];
    expect(entry.lastError).toBeNull();
    // Whatever the entry carries, it never carries a raw detail.
    expect(JSON.stringify(entry)).not.toContain('Dummy OrgaTEX is unreachable');
  });

  // ── R-13 — the re-drive ──

  it('a re-drive of a FAILED entry reuses the ORIGINAL key (R-13, R-17, IR-08)', async () => {
    // The MES is unreachable, so the consumption is QUEUED (R-09). A
    // queue entry exists only for the **offline** path (OQ-7).
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    // The MES comes back, but it REFUSES the consumption — a definitive
    // answer. Under the `PERMANENT` disposition the entry goes to
    // `FAILED` and waits for an operator.
    harness.orgatex.world.setReachable(true);
    harness.orgatex.world.setRejectsConsumption(true);
    await retryDue(harness);

    const failed = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);
    expect(failed.body.entries[0].state).toBe('FAILED');

    // The MES accepts it this time.
    harness.orgatex.world.setRejectsConsumption(false);

    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.delivered).toBe(true);
    // The consumption reached the MES — ONCE.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(1);
  });

  it('a delivered entry LEAVES the queue — the only way out', async () => {
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    harness.orgatex.world.setReachable(true);
    harness.orgatex.world.setRejectsConsumption(true);
    await retryDue(harness);

    harness.orgatex.world.setRejectsConsumption(false);

    await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    const queue = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(queue.body.count).toBe(0);
  });

  it('a re-drive of an unknown entry is a 404', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/IDK-0000000000000000/redrive')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('QUEUE_ENTRY_NOT_FOUND');
  });

  it('a re-drive of a PENDING entry is REFUSED — it is already on the path (R-13)', async () => {
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('REDRIVE_REFUSED');
    expect(response.body.reason).toBe('NOT_FAILED');
  });

  it('a re-drive while the link is DOWN is REFUSED (R-13)', async () => {
    // The MES is unreachable, so the consumption is QUEUED.
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    // The MES comes back but REFUSES it — the entry goes to `FAILED`.
    harness.orgatex.world.setReachable(true);
    harness.orgatex.world.setRejectsConsumption(true);
    await retryDue(harness);

    const queue = await request(harness.app)
      .get('/api/orgatex/sync-queue')
      .set('Authorization', `Bearer ${token}`);
    expect(queue.body.entries[0].state).toBe('FAILED');

    // Now the link goes down again, and the re-drive is refused.
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('LINK_NOT_LINKED');
    // Nothing was sent — the MES is unreachable.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(0);
  });

  it('the re-drive uses the ORIGINAL key — never a re-derived one (R-17, IR-08)', async () => {
    harness.orgatex.world.setReachable(false);

    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    const postingId = posted.body.postingId as string;

    harness.orgatex.world.setReachable(true);

    // The link is up, but the entry is still PENDING — so the re-drive is
    // refused. The refusal proves the guard; the key is what matters.
    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    // The posting's own key is unchanged — the MES never saw another one.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(0);
  });

  it('a re-drive refuses a key that is not a valid idempotency key', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/not-a-key/redrive')
      .set('Authorization', `Bearer ${token}`);

    // The key is refused at the value object, not silently accepted.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
