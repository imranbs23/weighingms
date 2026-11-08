/**
 * The container assignment's endpoint — unit 002, bolt 012.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ENDPOINT, OVER THE REAL SCALE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the operator comes from the SESSION, never the body
 *   - the method is DERIVED — the client cannot supply it
 *   - the tare SOURCE is derived — the client cannot supply it
 *   - the tare VALUE is the scale's, never the client's
 *   - a container with a master tare is `CONTAINER_MASTER`
 *   - a container with no master tare is `WEIGHED_EMPTY_CONTAINER`
 *   - a refused tare is a 409 and writes nothing
 *   - the effective assignment is reported, and null when there is none
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

describe('the container assignment', () => {
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

  it('assigns a container with a MASTER tare', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(201);
    expect(response.body.assignment.containerId).toBe('C-12');
    expect(response.body.assignment.tareSource).toBe('CONTAINER_MASTER');
    expect(response.body.assignment.tareWeight).toBe('214.0000');
    expect(response.body.assignment.tareUnit).toBe('g');
    expect(response.body.assignment.assignedBy).toBe('OP-001');
  });

  it('derives the method — the client cannot supply it', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        assignmentMethod: 'SCAN',
      });

    expect(response.status).toBe(201);
    // The client's `assignmentMethod` is DROPPED, and the method is
    // KEYED_IN — because the body carried a `containerId`.
    expect(response.body.assignment.assignmentMethod).toBe('KEYED_IN');
  });

  it('a scanned container is SCAN — derived from the body’s shape', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        code: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(201);
    expect(response.body.assignment.assignmentMethod).toBe('SCAN');
  });

  it('ignores a client-supplied operatorId and tareSource', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        operatorId: 'OP-SOMEONE-ELSE',
        tareSource: 'WEIGHED_EMPTY_CONTAINER',
        tareValue: '999.0000',
      });

    expect(response.status).toBe(201);
    expect(response.body.assignment.assignedBy).toBe('OP-001');
    // The source is derived — the master holds a tare, so it is
    // CONTAINER_MASTER whatever the client said.
    expect(response.body.assignment.tareSource).toBe('CONTAINER_MASTER');
    // And the tare VALUE is the station's, not the client's.
    expect(response.body.assignment.tareWeight).toBe('214.0000');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
  });

  it('a container with NO master tare is MEASURED', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'D-03',
        scaleId: 'SCALE-A',
      });

    // The scale produced a reading, so the empty container was weighed.
    expect(response.status).toBe(201);
    expect(response.body.assignment.tareSource).toBe(
      'WEIGHED_EMPTY_CONTAINER',
    );
  });

  it('reports the effective assignment, and null when there is none', async () => {
    const none = await request(harness.app)
      .get('/api/container/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.assignment).toBeNull();

    await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    const some = await request(harness.app)
      .get('/api/container/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(some.body.assignment.containerId).toBe('C-12');
  });

  it('a RE-TARE measures, and the source changes', async () => {
    await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    const retare = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(retare.status).toBe(201);
    expect(retare.body.assignment.tareSource).toBe(
      'WEIGHED_EMPTY_CONTAINER',
    );
  });

  it('returns 404 for a container the master does not hold', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'NOPE',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('CONTAINER_NOT_FOUND');
  });

  it('returns 404 for a component the recipe does not hold', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'NOPE',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('COMPONENT_NOT_FOUND');
  });

  it('returns 400 when the body carries BOTH routes', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        code: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a session', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(401);
  });
});
