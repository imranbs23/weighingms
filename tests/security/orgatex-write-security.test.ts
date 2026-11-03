/**
 * The OrgaTEX write path's security properties.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE WRITE PATH'S THREE REAL RISKS
 * ══════════════════════════════════════════════════════════════════════
 *
 * 1. **Privilege escalation through the body.** A request that could name
 *    the operator would let a caller post a consumption as somebody
 *    else — a falsified dye record on a real order. FR-18 requires the
 *    operator's identity on the posting; it does NOT say the caller
 *    supplies it.
 *
 * 2. **A forged idempotency key.** A client that could choose the key
 *    could choose one that collides with another weighing's and
 *    suppress it — a lost consumption.
 *
 * 3. **The MES's internal message reaching the client.** IR-09 says the
 *    failure is diagnosable without MES access; that means the LOG
 *    carries the detail, not that the response does.
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

describe('the OrgaTEX write path — security', () => {
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
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  // ── The session boundary ──

  it('refuses a consumption posting without a session', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .send(body());
    expect(response.status).toBe(401);
  });

  it('refuses a consumption posting with a malformed token', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(body());
    expect(response.status).toBe(401);
  });

  it('refuses a consumption posting once the session has ended', async () => {
    await request(harness.app)
      .post('/api/identity/sign-out')
      .set('Authorization', `Bearer ${token}`);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(401);
  });

  it('refuses a status write without a session', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .send({ status: 'WEIGHED' });
    expect(response.status).toBe(401);
  });

  // ── The operator cannot be forged ──

  it('records the SESSION operator, not one named in the body', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ operatorId: 'OP-SOMEONE-ELSE' }));

    const { BatchId } = await import(
      '../../src/005-orgatex-integration/domain/value-objects/identifiers.js'
    );
    const postings = await harness.orgatex.postings.findByBatch(
      BatchId.create('B-24187'),
    );

    expect(postings).toHaveLength(1);
    expect(postings[0]?.operatorId.value).toBe(OPERATOR_ID);
  });

  it('records a SUPERVISOR session operator, not one named in the body', async () => {
    await seedOperator(
      harness,
      'SV-001',
      'A. Supervisor',
      'SUPERVISOR',
      '9931',
    );
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'SV-001', secret: '9931' });
    const supervisorToken = signIn.body.token as string;

    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send(body({ operatorId: 'OP-SOMEONE-ELSE' }));

    const { BatchId } = await import(
      '../../src/005-orgatex-integration/domain/value-objects/identifiers.js'
    );
    const postings = await harness.orgatex.postings.findByBatch(
      BatchId.create('B-24187'),
    );

    expect(postings[0]?.operatorId.value).toBe('SV-001');
  });

  it('has NO operatorId field in the consumption schema', async () => {
    const { consumptionPostingSchema } = await import(
      '../../src/005-orgatex-integration/presentation/schemas/orgatex-write-schemas.js'
    );

    // The field does not exist in the schema, so it cannot be sent.
    expect(
      Object.keys(consumptionPostingSchema.shape),
    ).not.toContain('operatorId');
  });

  // ── The key cannot be forged ──

  it('has NO idempotencyKey field in the consumption schema', async () => {
    const { consumptionPostingSchema } = await import(
      '../../src/005-orgatex-integration/presentation/schemas/orgatex-write-schemas.js'
    );

    expect(
      Object.keys(consumptionPostingSchema.shape),
    ).not.toContain('idempotencyKey');
  });

  it('has NO state field in the consumption schema', async () => {
    const { consumptionPostingSchema } = await import(
      '../../src/005-orgatex-integration/presentation/schemas/orgatex-write-schemas.js'
    );

    expect(Object.keys(consumptionPostingSchema.shape)).not.toContain('state');
  });

  it('derives the key itself, whatever the body claims', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ idempotencyKey: 'IDK-ffffffffffffffff' }));

    expect(response.status).toBe(201);
    expect(response.body.postingId).not.toBe('IDK-ffffffffffffffff');
  });

  it('does NOT let a body key suppress another weighing', async () => {
    // A forged key that collides with a real one must not stop a
    // DIFFERENT weighing from being posted — the body key is ignored,
    // so the derived key decides.
    const first = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const second = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(
        body({
          idempotencyKey: first.body.postingId,
          weighedAt: '2026-11-02T08:15:00.000Z',
        }),
      );

    expect(second.status).toBe(201);
    expect(second.body.postingId).not.toBe(first.body.postingId);
  });

  // ── The MES's internals stay internal ──

  it('does NOT leak the MES failure message to the client', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('unreachable');
    expect(serialised).not.toContain('Dummy OrgaTEX');
  });

  it('reports a rejection as a CODE, with a bounded detail', async () => {
    harness.orgatex.world.setRejectsConsumption(true);

    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.body.reason).toBe('BATCH_NOT_POSTABLE');
    expect(typeof response.body.detail).toBe('string');
    expect(String(response.body.detail).length).toBeLessThanOrEqual(600);
  });

  // ── The write path's blast radius ──

  it('does NOT persist the operator secret or the session token', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const rows = harness.orgatex.database
      .prepare('SELECT * FROM consumption_postings')
      .all() as unknown as Record<string, unknown>[];

    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(OPERATOR_SECRET);
    expect(serialised).not.toContain(token);
  });

  it('stores the quantity as TEXT, so no float is ever persisted', async () => {
    await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    const row = harness.orgatex.database
      .prepare(
        'SELECT typeof(actual_quantity) AS t FROM consumption_postings LIMIT 1',
      )
      .get() as unknown as { t: string };

    expect(row.t).toBe('text');
  });

  it('bounds the identifier lengths it accepts', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ componentId: 'C'.repeat(500) }));

    expect(response.status).toBe(400);
  });

  it('refuses a body larger than the limit', async () => {
    // The body limit is enforced by the shared middleware, so it applies
    // to the write endpoints too.
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ lotNumber: 'L'.repeat(200_000) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('does NOT let an unauthenticated caller reach the Dummy MES write surface through the product namespace', async () => {
    // The Dummy MES's surface is open BY DESIGN (it is the external
    // system). The product's namespace is not. Both are mounted under
    // /api, and the product's routes are session-guarded.
    const product = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/consumption')
      .send(body());
    expect(product.status).toBe(401);

    // The Dummy's own path is open — and it is a DIFFERENT path.
    const dummy = await request(harness.app)
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
    expect(dummy.status).toBe(201);
  });

  it('requires a session for the rejection training control', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control/reject')
      .send({ reject: true, target: 'CONSUMPTION' });

    expect(response.status).toBe(401);
  });

  it('requires a session for the outage training control', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/control')
      .send({ state: 'UNREACHABLE' });

    expect(response.status).toBe(401);
  });
});
