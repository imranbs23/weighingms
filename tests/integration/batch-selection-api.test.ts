/**
 * The station's batch queue filter, and the batch selection.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DATA REALLY COMES FROM THE MES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The harness binds the real `BatchQueueReader` over the real Dummy
 * OrgaTEX, so every row below arrived through the seam. There is no
 * fixture and no double.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * The filter:
 *   - `?status=` narrows the rows, and the count matches the match count
 *   - the ABSENT parameter is "All" — and it is the only spelling
 *   - an unknown status is a 400, never a silently widened answer
 *   - the receipt time and the freshness are UNCHANGED by the filter
 *   - the offered statuses are the queue's, not the MES's vocabulary
 *   - a filter that matches nothing is a 200 with zero rows — NOT an error
 *
 * The selection:
 *   - a touch records TOUCH; a scan records SCAN
 *   - the operator comes from the SESSION, never the body
 *   - the method is DERIVED — the client cannot supply it
 *   - an ineligible batch is a 409 with the SPECIFIC reason
 *   - an unrecognised code is a 409 with its own reason
 *   - a refusal writes NOTHING
 *   - the selection survives and is reported by `GET /api/selection`
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

describe('the batch queue filter', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('applies no filter when none is given — every batch is shown', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.filter).toBeNull();
    expect(response.body.batches.length).toBeGreaterThan(0);
  });

  it('narrows the rows to the chosen status', async () => {
    const all = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    const filtered = await request(harness.app)
      .get('/api/batch-queue?status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    expect(filtered.status).toBe(200);
    expect(filtered.body.filter).toEqual({ status: 'QUEUED' });

    // Every row has the status, and the count is the match count.
    const statuses = (
      filtered.body.batches as { weighingStatus: string }[]
    ).map((b) => b.weighingStatus);
    expect(statuses.every((s) => s === 'QUEUED')).toBe(true);
    expect(filtered.body.batches.length).toBe(
      (all.body.batches as unknown[]).filter(
        (b) => (b as { weighingStatus: string }).weighingStatus === 'QUEUED',
      ).length,
    );
  });

  it('keeps the receipt time UNCHANGED while a filter is applied', async () => {
    const all = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);
    const filtered = await request(harness.app)
      .get('/api/batch-queue?status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    // The filtered view is a view of the SAME queue — the operator can
    // still see how old the underlying data is.
    expect(filtered.body.receivedAt).toBe(all.body.receivedAt);
    expect(filtered.body.freshness).toEqual(all.body.freshness);
  });

  it('offers the statuses PRESENT in the queue — not the MES\'s whole vocabulary', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue')
      .set('Authorization', `Bearer ${token}`);

    const statuses = response.body.statuses as string[];
    const inQueue = new Set(
      (response.body.batches as { weighingStatus: string }[]).map(
        (b) => b.weighingStatus,
      ),
    );

    // The Dummy's seed holds `WEIGHING` and `QUEUED` only. The MES's
    // vocabulary has five — and the other three are NOT offered, because
    // they are not in this queue (ADR-030).
    expect(new Set(statuses)).toEqual(inQueue);
    expect(statuses.length).toBe(inQueue.size);
    expect(statuses).not.toContain('CANCELLED');
    expect(statuses).not.toContain('WEIGHED');
  });

  it('still offers every status when a filter is applied', async () => {
    // If the options were derived from the FILTERED rows, applying a
    // filter would shrink the control to the one status being filtered by
    // — and the operator could narrow the queue and never widen it again.
    const response = await request(harness.app)
      .get('/api/batch-queue?status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    const statuses = response.body.statuses as string[];
    expect(statuses).toContain('QUEUED');
    expect(statuses).toContain('WEIGHING');
  });

  it('returns a 200 with zero rows when the filter matches nothing', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue?status=WEIGHED')
      .set('Authorization', `Bearer ${token}`);

    // An explicit "no batches match this filter" state and zero rows —
    // and NOT an error (FR-1).
    expect(response.status).toBe(200);
    expect(response.body.batches).toEqual([]);
    // The receipt time is still there — the queue was still received.
    expect(typeof response.body.receivedAt).toBe('string');
  });

  it('refuses an unknown status with a 400', async () => {
    const response = await request(harness.app)
      .get('/api/batch-queue?status=NOT_A_STATUS')
      .set('Authorization', `Bearer ${token}`);

    // Never a silently widened answer, and never mapped to "All".
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(response.body).not.toHaveProperty('batches');
  });

  it('refuses the filter without a session', async () => {
    const response = await request(harness.app).get('/api/batch-queue?status=QUEUED');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  it('still fails loudly with a 503 when the MES is unreachable', async () => {
    harness.orgatex.world.setReachable(false);

    const response = await request(harness.app)
      .get('/api/batch-queue?status=QUEUED')
      .set('Authorization', `Bearer ${token}`);

    // The filter does not change the AVAILABILITY of the queue.
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('BATCH_QUEUE_UNAVAILABLE');
    expect(response.body).not.toHaveProperty('batches');
  });
});

describe('the batch selection', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;

    // The Dummy's seed holds no RELEASED batch, and a station must be
    // given one before it can weigh one (BRD BR-03). So the batch is
    // released here — through the Dummy's own world, which is the MES's
    // side of the seam.
    harness.orgatex.world.setWeighingStatus('B-24188', 'RELEASED');
  });

  afterEach(() => {
    harness.close();
  });

  it('refuses the selection without a session', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .send({ batchId: 'B-24188' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  it('refuses to read the selection without a session', async () => {
    const response = await request(harness.app).get('/api/selection');

    expect(response.status).toBe(401);
  });

  it('reports no selection before anything has been chosen', async () => {
    const response = await request(harness.app)
      .get('/api/selection')
      .set('Authorization', `Bearer ${token}`);

    // An empty selection is a STATE — a 200 with null, never a 404.
    expect(response.status).toBe(200);
    expect(response.body.selection).toBeNull();
  });

  it('records a touch, with the operator and the method', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });

    expect(response.status).toBe(201);
    expect(response.body.selection.batchId).toBe('B-24188');
    expect(response.body.selection.orderRef).toBe('SO-9931');
    expect(response.body.selection.machineRef).toBe('JET-07');
    expect(response.body.selection.operatorId).toBe(OPERATOR_ID);
    expect(response.body.selection.selectionMethod).toBe('TOUCH');
    expect(typeof response.body.selection.selectedAt).toBe('string');
  });

  it('records a scan, with the method derived from the request', async () => {
    harness.scanner.present('B-24188');

    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'B-24188' });

    expect(response.status).toBe(201);
    expect(response.body.selection.selectionMethod).toBe('SCAN');
    expect(response.body.selection.batchId).toBe('B-24188');
  });

  it('reports the selection after it has been made', async () => {
    await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });

    const response = await request(harness.app)
      .get('/api/selection')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.selection.batchId).toBe('B-24188');
    expect(response.body.selection.selectionMethod).toBe('TOUCH');
  });

  it('SUPERSEDES the previous selection when a new one is made', async () => {
    harness.orgatex.world.setWeighingStatus('B-24190', 'RELEASED');

    const first = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });
    expect(first.status).toBe(201);

    const second = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24190' });
    expect(second.status).toBe(201);

    const response = await request(harness.app)
      .get('/api/selection')
      .set('Authorization', `Bearer ${token}`);

    // The crumb updates to the newly selected batch.
    expect(response.body.selection.batchId).toBe('B-24190');
  });

  it('refuses a batch that is not RELEASED, with the specific reason', async () => {
    // B-24187 is `WEIGHING` — another station is working it.
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24187' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SELECTION_REFUSED');
    expect(response.body.reason).toBe('BEING_WEIGHED_ELSEWHERE');
  });

  it('refuses a batch that is not RELEASED — and writes NOTHING', async () => {
    await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24187' });

    const response = await request(harness.app)
      .get('/api/selection')
      .set('Authorization', `Bearer ${token}`);

    // A refusal is not a selection.
    expect(response.body.selection).toBeNull();
  });

  it('refuses a scan whose code names nothing the MES knows', async () => {
    harness.scanner.present('B-99999');

    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'B-99999' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SELECTION_REFUSED');
    expect(response.body.reason).toBe('UNRECOGNISED_CODE');
  });

  it('reports a disconnected scanner as unavailable — not as a refusal', async () => {
    harness.scanner.disconnect();

    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'B-24188' });

    // The operator may fall back to touching the row (BRD FR-19).
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('SCANNER_UNAVAILABLE');
  });

  it('refuses a body with NEITHER batchId nor code', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses a body with BOTH batchId and code', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', code: 'B-24188' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('takes the operator from the SESSION, never from the body', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', operatorId: 'OP-999' });

    expect(response.status).toBe(201);
    // The body's operatorId is STRIPPED — the field does not exist in the
    // schema, so it cannot be sent (ADR-005).
    expect(response.body.selection.operatorId).toBe(OPERATOR_ID);
  });

  it('DERIVES the method — the body cannot choose it', async () => {
    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188', selectionMethod: 'SCAN' });

    expect(response.status).toBe(201);
    // The body's selectionMethod is STRIPPED. A touch is a TOUCH, and a
    // client cannot record a scan that never happened (ADR-030).
    expect(response.body.selection.selectionMethod).toBe('TOUCH');
  });

  it('selects a batch that is NOT in the currently filtered queue', async () => {
    // The filter is a VIEW. Eligibility is what gates — so a selection
    // succeeds even when the operator's filter hides the batch.
    const filtered = await request(harness.app)
      .get('/api/batch-queue?status=WEIGHING')
      .set('Authorization', `Bearer ${token}`);

    // B-24188 is RELEASED, so it is not in the WEIGHING view…
    expect(
      (filtered.body.batches as { batchId: string }[]).some(
        (b) => b.batchId === 'B-24188',
      ),
    ).toBe(false);

    const response = await request(harness.app)
      .post('/api/selection')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'B-24188' });

    expect(response.status).toBe(201);
  });
});
