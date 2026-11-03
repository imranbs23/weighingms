/**
 * The OrgaTEX write path's HTTP surface.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATUS CODES ARE THE CONTRACT
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge cases are mostly about which outcome is reported, and
 * the system context's governing rule is *"no failure at any boundary may
 * produce a silently wrong number"*. So these tests are largely about
 * **what the response says**:
 *
 *   - 201 ACCEPTED — the MES took it
 *   - 200 DUPLICATE — it was already done, and nothing was added
 *   - 201 QUEUED — the MES could not be reached; **pending**, not posted
 *   - 422 REJECTED — the MES reached it and refused, with a reason code
 *   - 409 — the batch's postings are not all resolved
 *
 * And about the two boundaries that matter most:
 *
 *   - the **operator comes from the session**, not the body
 *   - a **quantity is a string**, never a JSON number
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

/** A valid consumption body. */
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

describe('the OrgaTEX write API', () => {
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

  it('refuses a consumption posting without a session', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .send(body());

    expect(response.status).toBe(401);
  });

  it('refuses a status write without a session', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(401);
  });

  // ── The operator comes from the session ──

  it('takes the operator from the session, not from the body', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ operatorId: 'OP-999' }));

    expect(response.status).toBe(201);

    // The MES received the SIGNED-IN operator, not the one in the body.
    const consumed = harness.orgatex.world.readConsumption('B-24187');
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.componentId).toBe('C-01');
  });

  it('ignores an operatorId sent in the body', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ operatorId: 'OP-999' }));

    const posting = await harness.orgatex.postings.findByBatch(
      (await import(
        '../../src/005-orgatex-integration/domain/value-objects/identifiers.js'
      )).BatchId.create('B-24187'),
    );

    expect(posting).toHaveLength(1);
    expect(posting[0]?.operatorId.value).toBe(OPERATOR_ID);
  });

  // ── The quantity is a string ──

  it('refuses a quantity sent as a JSON number', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ actualQuantity: 94.01 }));

    expect(response.status).toBe(400);
  });

  it('refuses a malformed quantity', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ actualQuantity: 'ninety four' }));

    expect(response.status).toBe(400);
  });

  it('refuses a body with no component', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send({ actualQuantity: '94.01', unit: 'g', lotNumber: 'L-1', weighedAt: WEIGHED_AT });

    expect(response.status).toBe(400);
  });

  it('refuses a weighedAt that is not an instant', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: 'yesterday' }));

    expect(response.status).toBe(400);
  });

  // ── The accepted path ──

  it('accepts a consumption and reports it as accepted', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('ACCEPTED');
    expect(response.body.postingId).toMatch(/^IDK-/);
  });

  it('records the consumption against the batch in the MES', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const consumed = harness.orgatex.world.readConsumption('B-24187');
    expect(consumed).toHaveLength(1);
  });

  it('records the key in the ledger', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const key = await import(
      '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js'
    );
    const recorded = await harness.orgatex.ledger.has(
      key.IdempotencyKey.of(response.body.postingId as string),
    );
    expect(recorded).toBe(true);
  });

  // ── The duplicate ──

  it('reports a duplicate as a 200 and adds nothing', async () => {
    const first = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    expect(first.status).toBe(201);

    const second = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    // A duplicate is NOT an error.
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.postingId).toBe(first.body.postingId);

    // Exactly one consumption exists.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(1);
  });

  it('treats a second weighing of the same component as a NEW posting', async () => {
    const first = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const second = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ weighedAt: '2026-11-02T08:15:00.000Z' }));

    expect(second.status).toBe(201);
    expect(second.body.postingId).not.toBe(first.body.postingId);
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(2);
  });

  // ── The unreachable MES ──

  it('reports an unreachable MES as pending, not as posted', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    // 201 with QUEUED — the request WAS accepted for delivery.
    expect(response.status).toBe(201);
    expect(response.body.state).toBe('QUEUED');
    expect(response.body.pending).toBe(true);
  });

  it('does not record a queued posting in the ledger', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const rows = harness.orgatex.database
      .prepare('SELECT COUNT(*) AS n FROM idempotency_ledger')
      .get() as unknown as { n: number };
    expect(rows.n).toBe(0);
  });

  it('refuses a second enqueue of a queued key', async () => {
    harness.orgatex.world.setReachable(false);

    const first = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    expect(first.body.state).toBe('QUEUED');

    harness.orgatex.world.setReachable(true);

    const second = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    // The second submission did NOT send — one queue entry, one weighing.
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(0);
  });

  // ── The rejection ──

  it('reports a refusal from the MES as a 422 with a reason code', async () => {
    harness.orgatex.world.setRejectsConsumption(true);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('POSTING_REJECTED');
    expect(response.body.reason).toBe('BATCH_NOT_POSTABLE');
  });

  it('retains the rejected posting rather than discarding it', async () => {
    harness.orgatex.world.setRejectsConsumption(true);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const rows = harness.orgatex.database
      .prepare('SELECT COUNT(*) AS n FROM consumption_postings')
      .get() as unknown as { n: number };
    expect(rows.n).toBe(1);
  });

  it('records the attempt history for a rejection', async () => {
    harness.orgatex.world.setRejectsConsumption(true);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const rows = harness.orgatex.database
      .prepare('SELECT COUNT(*) AS n FROM posting_attempts')
      .get() as unknown as { n: number };
    expect(rows.n).toBe(1);
  });

  it('records the attempt history for an unreachable MES', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const rows = harness.orgatex.database
      .prepare(
        "SELECT outcome FROM posting_attempts WHERE outcome = 'UNREACHABLE'",
      )
      .all() as unknown as { outcome: string }[];
    expect(rows).toHaveLength(1);
  });

  // ── The batch status ──

  it('advances the batch to WEIGHED when every posting is resolved', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('WEIGHED');
  });

  it('alters NO other OrgaTEX batch field', async () => {
    const before = harness.orgatex.world.readQueue().batches.find(
      (batch) => batch.batchId === 'B-24187',
    );

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    const after = harness.orgatex.world.readQueue().batches.find(
      (batch) => batch.batchId === 'B-24187',
    );

    // The weighing status advanced. Everything else is untouched.
    expect(after?.weighingStatus).toBe('WEIGHED');
    expect(after?.orderRef).toBe(before?.orderRef);
    expect(after?.machineRef).toBe(before?.machineRef);
    expect(after?.fabricDescription).toBe(before?.fabricDescription);
    expect(after?.shadeCode).toBe(before?.shadeCode);
  });

  it('refuses the status write when a posting is unresolved', async () => {
    harness.orgatex.world.setReachable(false);

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('POSTINGS_UNRESOLVED');
    expect(response.body.unresolved).toBe(1);
  });

  it('refuses a status other than WEIGHED', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'QUEUED' });

    expect(response.status).toBe(400);
  });

  it('reports a refusal of the status write as a 422', async () => {
    harness.orgatex.world.setRejectsStatusWrite(true);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('POSTING_REJECTED');
  });

  it('reports an unreachable MES on a status write as pending', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('QUEUED');
    expect(response.body.pending).toBe(true);
  });

  it('refuses a status write for an empty body', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('the Dummy MES write API', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it('accepts a consumption WITHOUT a session', async () => {
    // The MES is the external system. The product's adapter reaches it
    // without a WeighingMS session.
    const response = await request(harness.app)
      .post('/api/batches/B-24187/consumption')
      .send({
        batchId: 'B-24187',
        componentId: 'C-01',
        actualQuantity: '94.01',
        unit: 'g',
        lotNumber: 'L-77120',
        operatorId: 'OP-001',
        weighedAt: WEIGHED_AT,
        idempotencyKey: 'IDK-cafebabe0badf00d',
      });

    expect(response.status).toBe(201);
    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(1);
  });

  it('refuses a consumption with a quantity that is a number', async () => {
    const response = await request(harness.app)
      .post('/api/batches/B-24187/consumption')
      .send({
        batchId: 'B-24187',
        componentId: 'C-01',
        actualQuantity: 94.01,
        unit: 'g',
        lotNumber: 'L-77120',
        operatorId: 'OP-001',
        weighedAt: WEIGHED_AT,
        idempotencyKey: 'IDK-cafebabe0badf00d',
      });

    expect(response.status).toBe(400);
  });

  it('refuses a consumption for a batch the path does not name', async () => {
    const response = await request(harness.app)
      .post('/api/batches/B-24187/consumption')
      .send({
        batchId: 'B-99999',
        componentId: 'C-01',
        actualQuantity: '94.01',
        unit: 'g',
        lotNumber: 'L-77120',
        operatorId: 'OP-001',
        weighedAt: WEIGHED_AT,
        idempotencyKey: 'IDK-cafebabe0badf00d',
      });

    expect(response.status).toBe(400);
  });

  it('does NOT deduplicate — it accepts every consumption it is given', async () => {
    // ADR-025: the LOCAL ledger is the guarantee. A Dummy that
    // deduplicated would hide the failure the ledger prevents.
    const payload = {
      batchId: 'B-24187',
      componentId: 'C-01',
      actualQuantity: '94.01',
      unit: 'g',
      lotNumber: 'L-77120',
      operatorId: 'OP-001',
      weighedAt: WEIGHED_AT,
      idempotencyKey: 'IDK-cafebabe0badf00d',
    };

    await request(harness.app).post('/api/batches/B-24187/consumption').send(payload);
    await request(harness.app).post('/api/batches/B-24187/consumption').send(payload);

    expect(harness.orgatex.world.readConsumption('B-24187')).toHaveLength(2);
  });

  it('accepts a status write WITHOUT a session', async () => {
    const response = await request(harness.app)
      .post('/api/batches/B-24187/status')
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(200);
  });

  it('refuses a status other than WEIGHED', async () => {
    const response = await request(harness.app)
      .post('/api/batches/B-24187/status')
      .send({ status: 'CANCELLED' });

    expect(response.status).toBe(400);
  });

  it('reports a 503 while the MES is unreachable', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/batches/B-24187/consumption')
      .send({
        batchId: 'B-24187',
        componentId: 'C-01',
        actualQuantity: '94.01',
        unit: 'g',
        lotNumber: 'L-77120',
        operatorId: 'OP-001',
        weighedAt: WEIGHED_AT,
        idempotencyKey: 'IDK-cafebabe0badf00d',
      });

    expect(response.status).toBe(503);
  });
});
