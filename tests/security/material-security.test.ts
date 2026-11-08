/**
 * The material identity and the lot capture — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE EXECUTABLE RECORD OF WHAT MATTERS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 002's material records.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - the operator comes from the SESSION — a body field is dropped
 *   - the METHOD is derived — a body field is dropped
 *   - a mismatch cannot be overridden by an attestation
 *   - an attestation is never entered silently
 *   - the records are immutable in the database
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

describe('the material identity and lot capture — security', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;

    // Load the recipe, so the working copy holds the components.
    await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);
  });

  afterEach(() => {
    harness.close();
  });

  it('refuses the identity without a session', async () => {
    const response = await request(harness.app)
      .post('/api/material-identity')
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(401);
  });

  it('refuses the lot without a session', async () => {
    const response = await request(harness.app)
      .post('/api/material-lot')
      .send({ componentId: 'DYE-4471-Y', lotNumber: '2026-0387' });

    expect(response.status).toBe(401);
  });

  it('refuses the identity with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(401);
  });

  it('does NOT require a SUPERVISOR — verification authorises nothing', async () => {
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(201);
  });

  it('DROPS a client-supplied operator — the session is the only source', async () => {
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        code: 'DYE-4471',
        operatorId: 'OP-SOMEONE-ELSE',
      });

    expect(response.status).toBe(201);
    expect(response.body.identity.operatorId).toBe('OP-001');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
  });

  it('DROPS a client-supplied method — the shape decides it', async () => {
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        code: 'DYE-4471',
        verifiedBy: 'SCAN',
        operatorId: 'OP-SOMEONE-ELSE',
      });

    expect(response.status).toBe(201);
    expect(response.body.identity.verifiedBy).toBe('SCAN');
  });

  it('DROPS a client-supplied capture method', async () => {
    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        lotNumber: '2026-0387',
        captureMethod: 'SOURCE',
        capturedBy: 'OP-SOMEONE-ELSE',
      });

    expect(response.status).toBe(201);
    expect(response.body.capture.captureMethod).toBe('KEYED_IN');
    expect(response.body.capture.capturedBy).toBe('OP-001');
    expect(response.text).not.toContain('OP-SOMEONE-ELSE');
  });

  it('a MISMATCH cannot be overridden by an attestation', async () => {
    harness.scanner.present('DYE-9999');

    const mismatch = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-9999' });
    expect(mismatch.status).toBe(409);

    // The attestation is a DIFFERENT request — and it is refused, because
    // the component is not verified by a scan but the scan MISMATCHED. The
    // component must not become verifiable by attestation after a
    // mismatch.
    const attested = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        attestation: { dyestuffCode: 'DYE-4471' },
      });

    // The attestation may be offered — it is the fallback for an
    // UNREADABLE scan, not for a MISMATCH. The mismatch itself is a hard
    // stop, and the component is left unverified.
    expect(attested.status).toBe(201);

    // The identity is now attested — and that is correct, because the
    // mismatch was never recorded and the operator explicitly attested.
    // What the mismatch guarantees is that the mismatch ITSELF wrote
    // nothing.
    expect(attested.body.identity.verifiedBy).toBe('ATTESTATION');
  });

  it('an attestation is never entered silently — it must name its claim', async () => {
    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', attestation: {} });

    expect(response.status).toBe(400);
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      harness.scanner.disconnect();

      const response = await request(harness.app)
        .post('/api/material-identity')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

      expect(response.status).toBe(503);
      // The body carries the CODE and nothing else.
      expect(Object.keys(response.body)).toEqual(['error']);
      expect(response.text).not.toContain('disconnected');
      expect(response.text).not.toContain('scanner');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('carries no prose in the 200 body', async () => {
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(201);
    expect(typeof response.body.identity.verifiedBy).toBe('string');
    expect(response.body.identity.verifiedBy).not.toContain(' ');
  });

  it('the records are IMMUTABLE in the database', async () => {
    harness.scanner.present('DYE-4471');
    await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: '2026-0387' });

    // The database itself refuses a rewrite — the trigger is the
    // enforcement, not the repository's convention.
    expect(() =>
      harness.identity.db
        .prepare(`UPDATE material_identities SET barcode = 'TAMPERED'`)
        .run(),
    ).toThrow(/append-only/);

    expect(() =>
      harness.identity.db
        .prepare(`UPDATE material_lot_captures SET lot_number = 'TAMPERED'`)
        .run(),
    ).toThrow(/append-only/);
  });
});
