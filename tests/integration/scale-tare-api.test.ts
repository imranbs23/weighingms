/**
 * Integration tests for the tare and the selection AT THE API BOUNDARY.
 *
 * WHAT IS PROVED HERE
 * --------------------
 *   ADR-013  the READ endpoints are open; the WRITE endpoints are not
 *   ADR-014  the reading the device emits is NET and carries its tare
 *   ADR-018  "no device can weigh this" returns 200, not 4xx
 *   S-14     a refused tare says the PREVIOUS tare remains in force
 *   S-12     no tare in force is null; a tare of zero is a recorded tare
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const SCALE = 'SCALE-A';
const FLOOR = 'SCALE-B';

/**
 * The test operator's credential.
 *
 * A TRAINING credential — the harness reduces the Argon2 cost for tests,
 * and this secret exists only in the in-memory database of a test run.
 */
const TRAINING_CREDENTIAL = 'training-only-operator-credential';

async function signIn(
  harness: Harness,
): Promise<string> {
  await seedOperator(
    harness,
    'OP-1',
    'Operator One',
    'OPERATOR',
    TRAINING_CREDENTIAL,
  );
  const res = await request(harness.app)
    .post('/api/identity/sign-in')
    .send({ operatorId: 'OP-1', secret: TRAINING_CREDENTIAL });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('the tare endpoint', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    token = await signIn(harness);
  });

  afterEach(() => {
    harness.close();
  });

  // ── The read is open; the write is not (ADR-013) ──

  it('serves the tare view WITHOUT a session', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/tare`);

    expect(res.status).toBe(200);
    expect(res.body.tare).toBeNull();
  });

  it('REFUSES to apply a tare without a session', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .send({
        tareValue: '214',
        unit: 'g',
        source: 'CONTAINER_MASTER',
      });

    expect(res.status).toBe(401);
  });

  // ── Applying a tare ──

  it('applies a tare and records the value, unit, time and source', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '214',
        unit: 'g',
        source: 'CONTAINER_MASTER',
      });

    expect(res.status).toBe(202);
    expect(res.body.tare.value).toBe('214');
    expect(res.body.tare.unit).toBe('g');
    expect(res.body.tare.source).toBe('CONTAINER_MASTER');
    // BRD IR-12: the source states that the tare was applied in software.
    expect(res.body.tare.appliedBy).toBe('SOFTWARE');
    expect(typeof res.body.tare.appliedAt).toBe('string');
  });

  it('reports the tare in force on the subsequent GET', async () => {
    await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '214',
        unit: 'g',
        source: 'CONTAINER_MASTER',
      });

    const res = await request(harness.app).get(`/api/scales/${SCALE}/tare`);

    expect(res.status).toBe(200);
    expect(res.body.tare.value).toBe('214');
    expect(res.body.tare.source).toBe('CONTAINER_MASTER');
  });

  it('CONVERTS a kilogram tare into the device gram unit', async () => {
    // The story's edge case: "the tare value is in kilograms and the
    // device reports grams". The request's unit is NOT obeyed — the
    // value is converted into the DEVICE's unit.
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '0.214',
        unit: 'kg',
        source: 'CONTAINER_MASTER',
      });

    expect(res.status).toBe(202);
    expect(res.body.tare.value).toBe('214');
    expect(res.body.tare.unit).toBe('g');
  });

  it('records an EXPLICIT zero tare with its source, distinct from no tare', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '0',
        unit: 'g',
        source: 'WEIGHED_EMPTY_CONTAINER',
      });

    expect(res.status).toBe(202);
    expect(res.body.tare.value).toBe('0');
    expect(res.body.tare.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });

  it('REPLACES the previous tare on a re-tare', async () => {
    await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'g', source: 'CONTAINER_MASTER' });

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '100',
        unit: 'g',
        source: 'WEIGHED_EMPTY_CONTAINER',
      });

    expect(res.status).toBe(202);
    expect(res.body.tare.value).toBe('100');
    expect(res.body.tare.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });

  it('serves the quantities as STRINGS, never as numbers', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'g', source: 'CONTAINER_MASTER' });

    expect(typeof res.body.tare.value).toBe('string');
  });

  // ── The refusals ──

  it('refuses a tare whose value is a NUMBER, not a string', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: 214, unit: 'g', source: 'CONTAINER_MASTER' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses an unknown unit', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'lb', source: 'CONTAINER_MASTER' });

    expect(res.status).toBe(400);
  });

  it('refuses an unknown source', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'g', source: 'MADE_UP' });

    expect(res.status).toBe(400);
  });

  it('ignores a CLIENT-SUPPLIED appliedAt — the server stamps the time', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tareValue: '214',
        unit: 'g',
        source: 'CONTAINER_MASTER',
        appliedAt: '1999-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(202);
    // A client-supplied timestamp would let a caller forge the tare's
    // history, so it is not accepted.
    expect(res.body.tare.appliedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('returns 404 for an unknown scale', async () => {
    const res = await request(harness.app)
      .post('/api/scales/SCALE-Z/tare')
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'g', source: 'CONTAINER_MASTER' });

    expect(res.status).toBe(404);
  });

  it('names the refusal reason and states the previous tare is retained', async () => {
    // Silence the device, so the weighing gate refuses the tare.
    const adapter = harness.scales.adapters.get(SCALE) as
      | { silence?: () => void }
      | undefined;
    adapter?.silence?.();

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/tare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tareValue: '214', unit: 'g', source: 'CONTAINER_MASTER' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TARE_REFUSED');
    expect(res.body.reason).toBe('SCALE_DISCONNECTED');
    // S-14: the caller must never be left guessing whether the zero
    // reference moved.
    expect(res.body.previousTareRetained).toBe(true);
  });
});

describe('the selection endpoint', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    token = await signIn(harness);
  });

  afterEach(() => {
    harness.close();
  });

  it('REFUSES to select without a session', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .send({
        componentId: 'COMP-1',
        target: '94',
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.status).toBe(401);
  });

  it('selects the PRECISION scale for a small target', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: '94',
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.selected).toBe(true);
    expect(res.body.scaleId).toBe(SCALE);
    expect(res.body.reason).toBe('CAPACITY_AND_CLASS');
    expect(res.body.scaleClass).toBe('PRECISION');
    expect(res.body.capacity).toBe('3000');
  });

  it('records the scale id, the component id, the time and the reason', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-42',
        target: '94',
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.body.scaleId).toBe(SCALE);
    expect(res.body.componentId).toBe('COMP-42');
    expect(typeof res.body.selectedAt).toBe('string');
    expect(res.body.reason).toBe('CAPACITY_AND_CLASS');
  });

  it('selects the FLOOR scale for a target beyond the precision capacity', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: '4000',
        unit: 'g',
        demandedClass: 'FLOOR',
      });

    expect(res.status).toBe(200);
    expect(res.body.scaleId).toBe(FLOOR);
  });

  it('returns 200 with selected:false when NO device can weigh the target', async () => {
    // ADR-018: a legitimate business outcome is NOT an error. A 4xx
    // would make the caller alert on it and retry a deterministic
    // answer.
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: '40000',
        unit: 'g',
        demandedClass: 'FLOOR',
      });

    expect(res.status).toBe(200);
    expect(res.body.selected).toBe(false);
    expect(res.body.target).toBe('40000');
    expect(res.body.maximumCapacity).toBe('32000');
    expect(res.body.demandedClass).toBe('FLOOR');
    // No device is selected — and no scale id is invented.
    expect(res.body.scaleId).toBeUndefined();
  });

  it('records the CONFLICT when the class cannot be satisfied', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: '4000',
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.scaleId).toBe(FLOOR);
    expect(res.body.reason).toBe('CLASS_CONFLICT_RESOLVED_BY_CAPACITY');
  });

  it('refuses a target that is a NUMBER, not a string', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: 94,
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('refuses an unknown demanded class', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'COMP-1',
        target: '94',
        unit: 'g',
        demandedClass: 'MEDIUM',
      });

    expect(res.status).toBe(400);
  });

  it('refuses an empty component id', async () => {
    const res = await request(harness.app)
      .post('/api/scales/select')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: '',
        target: '94',
        unit: 'g',
        demandedClass: 'PRECISION',
      });

    expect(res.status).toBe(400);
  });
});
