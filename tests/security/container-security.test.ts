/**
 * The container assignment — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TARE IS EVIDENCE THE STATION PRODUCED, NOT A NUMBER THE CLIENT CHOSE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 002's container assignment.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - the operator comes from the SESSION — a body field is dropped
 *   - the METHOD is derived — a body field is dropped
 *   - the tare SOURCE is derived — a body field is dropped
 *   - the tare VALUE is the station's, never the client's
 *   - the assignment is IMMUTABLE in the database
 *   - the diagnostic never reaches the client (BRD IR-09)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the container assignment — security', () => {
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

  it('refuses the assignment without a session', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(401);
  });

  it('refuses the assignment with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(401);
  });

  it('does NOT require a SUPERVISOR — assigning a container authorises nothing', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(201);
  });

  it('DROPS a client-supplied operator', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        operatorId: 'OP-SOMEONE-ELSE',
        assignedBy: 'OP-SOMEONE-ELSE',
      });

    expect(response.status).toBe(201);
    expect(response.body.assignment.assignedBy).toBe('OP-001');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
  });

  it('DROPS a client-supplied method', async () => {
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
    expect(response.body.assignment.assignmentMethod).toBe('KEYED_IN');
  });

  it('DROPS a client-supplied tare SOURCE', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        tareSource: 'WEIGHED_EMPTY_CONTAINER',
      });

    expect(response.status).toBe(201);
    // The master holds a tare, so the source is CONTAINER_MASTER whatever
    // the client said.
    expect(response.body.assignment.tareSource).toBe('CONTAINER_MASTER');
  });

  it('DROPS a client-supplied tare VALUE — the tare is the station’s', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        tareValue: '0.0000',
        tareWeight: '0.0000',
      });

    expect(response.status).toBe(201);
    // The master holds 214 g. A client-chosen tare would be a
    // client-chosen tolerance boundary (ADR-035).
    expect(response.body.assignment.tareWeight).toBe('214.0000');
  });

  it('refuses a FLOAT tare — the tare is a decimal string', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        tareValue: 214.5,
      });

    // The field does not exist, so it is stripped — and the station's own
    // tare is used. A float never reaches the domain.
    expect(response.status).toBe(201);
    expect(response.body.assignment.tareWeight).toBe('214.0000');
  });

  it('the assignment is IMMUTABLE in the database', async () => {
    await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    // The trigger is the enforcement, not the repository's convention.
    expect(() =>
      harness.identity.db
        .prepare(
          `UPDATE container_assignments SET tare_weight = '0.0000'`,
        )
        .run(),
    ).toThrow(/append-only/);
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A scale that will not respond — the tare is refused, and the
      // reason is a code.
      await request(harness.app)
        .post('/api/scales/SCALE-A/link')
        .set('Authorization', `Bearer ${token}`)
        .send({ state: 'DISCONNECTED' });

      const response = await request(harness.app)
        .post('/api/container')
        .set('Authorization', `Bearer ${token}`)
        .send({
          componentId: 'DYE-4471-Y',
          containerId: 'C-12',
          scaleId: 'SCALE-A',
        });

      expect([409, 503]).toContain(response.status);
      expect(response.text).not.toContain('C-12');
      expect(response.text).not.toContain('Dummy');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('carries no prose in the 200 body', async () => {
    const response = await request(harness.app)
      .post('/api/container')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
      });

    expect(response.status).toBe(201);
    expect(typeof response.body.assignment.tareWeight).toBe('string');
    expect(response.body.assignment.tareSource).not.toContain(' ');
  });
});
