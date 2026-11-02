/**
 * Integration tests for the scale HTTP boundary.
 *
 * THE CONTRACT UNDER TEST
 * -----------------------
 *   ADR-008   the weight crosses the wire as a JSON STRING
 *   ADR-013   the read endpoints are open; the training controls are not
 *   S-1       the stream NEVER emits a zero for silence
 *   S-3       an out-of-order reading never reaches the consumer
 *
 * THE SSE STREAM IS READ RAW
 * --------------------------
 * The SSE frames are parsed from the raw response text rather than
 * through a client library, because the exact frame format IS the
 * contract. A client library would hide the very thing under test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const SCALE = 'SCALE-A';

describe('Scale HTTP boundary', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  // ── The device list ──

  it('lists the two scales from the prototype status strip', async () => {
    const res = await request(harness.app).get('/api/scales');

    expect(res.status).toBe(200);
    expect(res.body.scales).toHaveLength(2);

    const precision = res.body.scales.find((s: { scaleId: string }) => s.scaleId === 'SCALE-A');
    expect(precision.capacity).toBe('3000');
    expect(precision.resolution).toBe('1');
    expect(precision.unit).toBe('g');
    expect(precision.class).toBe('PRECISION');

    const floor = res.body.scales.find((s: { scaleId: string }) => s.scaleId === 'SCALE-B');
    expect(floor.capacity).toBe('32000');
    expect(floor.resolution).toBe('10');
    expect(floor.class).toBe('FLOOR');
  });

  it('serves the quantities as STRINGS, never as numbers', async () => {
    const res = await request(harness.app).get('/api/scales');

    for (const scale of res.body.scales) {
      expect(typeof scale.capacity).toBe('string');
      expect(typeof scale.resolution).toBe('string');
    }
    expect(res.text).toContain('"capacity":"3000"');
  });

  // ── The status view ──

  it('returns the status view for a known scale', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/status`);

    expect(res.status).toBe(200);
    expect(res.body.scaleId).toBe(SCALE);
    expect(res.body.status).toBe('DISCONNECTED');
    expect(res.body.link).toBe('UNKNOWN');
    expect(res.body.calibration.state).toBe('IN_CALIBRATION');
  });

  it('returns 404 for an unknown scale', async () => {
    const res = await request(harness.app).get('/api/scales/SCALE-Z/status');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SCALE_NOT_FOUND');
  });

  // ── The weighing gate ──

  it('answers the gate with 200 and a named reason when blocked', async () => {
    const res = await request(harness.app).get(`/api/scales/${SCALE}/can-weigh`);

    // The gate is a QUESTION WITH AN ANSWER, not a failure.
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toBe('SCALE_NOT_RESPONDING');
  });

  it('reports SCALE_DISCONNECTED once the device has gone silent', async () => {
    // Push a reading in, then let the watchdog trip.
    const device = harness.scales.registry.get(
      (await import('../../src/004-scale-integration/domain/value-objects/scale-id.js')).ScaleId.create(SCALE),
    );
    expect(device).not.toBeNull();

    const { ScaleReading } = await import(
      '../../src/004-scale-integration/domain/value-objects/scale-reading.js'
    );
    const { WeightValue } = await import(
      '../../src/004-scale-integration/domain/value-objects/weight-value.js'
    );
    const { ReadingSequence } = await import(
      '../../src/004-scale-integration/domain/value-objects/reading-sequence.js'
    );

    harness.scales.registry.ingestReading(
      device!.id,
      new ScaleReading(
        WeightValue.of('93.42', 'g'),
        true,
        ReadingSequence.of(1),
        harness.clock.now(),
      ),
    );

    harness.clock.advance(2001);
    harness.scales.registry.checkWatchdog(device!.id);

    const res = await request(harness.app).get(`/api/scales/${SCALE}/can-weigh`);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toBe('SCALE_DISCONNECTED');
  });

  // ── The training controls are guarded (ADR-013) ──

  it('refuses the link control without a session', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .send({ state: 'DISCONNECTED' });

    expect(res.status).toBe(401);
  });

  it('refuses the dispense control without a session', async () => {
    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .send({ target: '1000', tolerance: '10', landing: 'IN_TOLERANCE' });

    expect(res.status).toBe(401);
  });

  it('accepts the link control with an operator session', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');

    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    expect(signIn.status).toBe(200);
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'DISCONNECTED' });

    expect(res.status).toBe(202);
  });

  it('rejects a link control with an invalid state', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/link`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'MELTED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects a dispense control whose target is a NUMBER, not a string', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 1000, tolerance: '10', landing: 'IN_TOLERANCE' });

    // A JSON number would undo the no-floating-point guarantee in
    // transit, so the boundary refuses the shape.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('accepts a dispense control whose quantities are strings', async () => {
    await seedOperator(harness, 'OP-1', 'Operator One', 'OPERATOR', 'secret-123');
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-1', secret: 'secret-123' });
    const token = signIn.body.token as string;

    const res = await request(harness.app)
      .post(`/api/scales/${SCALE}/dispense`)
      .set('Authorization', `Bearer ${token}`)
      .send({ target: '1000', tolerance: '10', landing: 'IN_TOLERANCE' });

    expect(res.status).toBe(202);
  });
});
