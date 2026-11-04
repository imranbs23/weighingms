/**
 * The link state's and the queue's remaining HTTP surface (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ENDPOINTS' EDGES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The happy paths are covered by `orgatex-link-state-api.test.ts` and
 * `orgatex-sync-queue-api.test.ts`. This file covers the **edges** — the
 * places where the controller has to make a decision, and where a wrong
 * decision is a wrong answer to the operator:
 *
 * - a malformed path parameter is a **400**, not a 500;
 * - a re-drive of an entry that is not in the queue is a **404**;
 * - a re-drive whose key is already consumed is refused, not re-sent;
 * - the queue's listing reports the count and each entry's state.
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

describe("the link state's and the queue's HTTP edges", () => {
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

  // ── The batch id is validated, not guessed ──

  it('refuses a malformed batch id on the consumption path with a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/%20/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    // A client mistake is a 400 — a 500 would tell the operator nothing
    // and leak the server's internals.
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses a malformed batch id on the status path with a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/%20/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses a malformed batch id on the recipe path with a 400', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/%20/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses an EMPTY batch id on the consumption path with a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/%20%20/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(400);
  });

  // ── The re-drive's refusals ──

  it('a re-drive of an entry that does not exist is a 404', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/IDK-0000000000000000/redrive')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('QUEUE_ENTRY_NOT_FOUND');
  });

  it('a re-drive of a MALFORMED key is a 400 — the key never reaches the queue', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/not-a-key/redrive')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('a re-drive of an OVER-LONG key is a 400', async () => {
    const response = await request(harness.app)
      .post(`/api/orgatex/sync-queue/${'A'.repeat(200)}/redrive`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  // ── The ledger's presence always wins ──

  it('a second submission of a CONSUMED key is refused as a duplicate (R-17)', async () => {
    // The MES accepts the consumption, so the key is in the ledger.
    const posted = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    expect(posted.status).toBe(201);
    expect(posted.body.postingId).toMatch(/^IDK-[0-9a-f]{16}$/);

    // The same weighing again — a duplicate, reported as a duplicate and
    // NOT as a failure (bolt 006's finding).
    const second = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    // The consumption exists exactly once in the MES.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(1);
  });

  // ── The queue's listing ──

  it('the listing reports the count and each entry\'s state', async () => {
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
    // The entry carries what the operator needs to recognise it.
    expect(response.body.entries[0].batchId).toBe('B-24187');
    expect(response.body.entries[0].componentId).toBe('C-01');
    expect(response.body.entries[0].postingId).toMatch(/^IDK-[0-9a-f]{16}$/);
  });

  // ── The link state and the count agree ──

  it('the link state and the queue count agree after an outage', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const state = await request(harness.app)
      .get('/api/orgatex/link-state')
      .set('Authorization', `Bearer ${token}`);

    // The station has never reached the MES, so it is OFFLINE — and the
    // count says what has not landed.
    expect(state.body.status).toBe('OFFLINE');
    expect(state.body.unsynchronisedCount).toBe(1);
  });

  // ── The re-drive that still fails ──

  it('a re-drive the MES refuses AGAIN reports the error — the code, not the detail', async () => {
    const harness2 = createHarness({
      orgatexRejectionDisposition: 'PERMANENT',
    });
    try {
      await seedOperator(
        harness2,
        OPERATOR_ID,
        'R. Karim',
        'OPERATOR',
        OPERATOR_SECRET,
      );
      const signIn = await request(harness2.app)
        .post('/api/identity/sign-in')
        .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
      const token2 = signIn.body.token as string;

      // The MES is unreachable, so the consumption is queued.
      harness2.orgatex.world.setReachable(false);
      const posted = await request(harness2.app)
        .post('/api/orgatex/batches/B-24187/consumption')
        .set('Authorization', `Bearer ${token2}`)
        .send(body());
      const postingId = posted.body.postingId as string;

      // The MES comes back and REFUSES it — a definitive answer, so the
      // entry goes to FAILED and waits for an operator.
      harness2.orgatex.world.setReachable(true);
      harness2.orgatex.world.setRejectsConsumption(true);

      const { Instant } = await import(
        '../../src/004-scale-integration/domain/value-objects/instant.js'
      );
      await harness2.orgatex.syncQueueService.retryDue(
        Instant.of(harness2.clock.now()),
      );

      // The re-drive is made, and the MES refuses again — so the entry
      // still carries its error, and the operator must SEE that it failed.
      const response = await request(harness2.app)
        .post(`/api/orgatex/sync-queue/${postingId}/redrive`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(200);
      expect(response.body.delivered).toBe(false);
      expect(response.body.state).toBe('FAILED');
      expect(response.body.lastError).not.toBeNull();
      expect(response.body.lastError.code).toBe('REJECTED');
      // The detail never reaches the client (NFR-11).
      expect(response.body.lastError).not.toHaveProperty('detail');
    } finally {
      harness2.close();
    }
  });

  // ── The status filter that is not a string ──

  it('a status filter that is NOT a string is a 400', async () => {
    // `?status[]=QUEUED` makes Express hand the query parser an ARRAY,
    // so the filter is not a string at all.
    const response = await request(harness.app)
      .get('/api/orgatex/batches?status[]=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });
});
