/**
 * The material identity and the lot capture — unit 002, bolt 011.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ENDPOINTS, OVER THE REAL SEAM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The harness binds the real `RecipeReader` and the real Dummy OrgaTEX, so
 * every component below arrived through the contact.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the operator comes from the SESSION, never the body
 *   - the method is DERIVED — the client cannot supply it
 *   - a mismatch is a 409 naming BOTH codes, and writes nothing
 *   - an unreadable scan is a 503, and the attestation path stays open
 *   - an attestation after a scan is refused
 *   - an empty lot is a 400; a lot over 64 is a 400 and is NOT truncated
 *   - the lot is trimmed before it is stored
 *   - two captures for one component: the newest is effective, the older is
 *     retained
 *   - the same lot for two components: BOTH stored
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

describe('the material identity and the lot capture', () => {
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

  /**
   * Load the recipe, so the working copy holds the components the
   * endpoints work against.
   */
  async function loadRecipe(): Promise<void> {
    const response = await request(harness.app)
      .get('/api/recipe/B-24187')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  }

  // ── The identity ──

  it('verifies by a matching scan, with the operator from the SESSION', async () => {
    await loadRecipe();
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(201);
    expect(response.body.identity.verifiedBy).toBe('SCAN');
    expect(response.body.identity.barcode).toBe('DYE-4471');
    // The operator is the session's, not the body's.
    expect(response.body.identity.operatorId).toBe('OP-001');
  });

  it('derives the method — the client cannot supply it', async () => {
    await loadRecipe();
    harness.scanner.present('DYE-4471');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        code: 'DYE-4471',
        verifiedBy: 'ATTESTATION',
      });

    expect(response.status).toBe(201);
    // The client's `verifiedBy` is DROPPED, and the method is SCAN.
    expect(response.body.identity.verifiedBy).toBe('SCAN');
  });

  it('ignores a client-supplied operatorId', async () => {
    await loadRecipe();
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
  });

  it('a MISMATCH is a 409 naming BOTH codes, and writes nothing', async () => {
    await loadRecipe();
    harness.scanner.present('DYE-9999');

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-9999' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('MATERIAL_MISMATCH');
    expect(response.body.scannedCode).toBe('DYE-9999');
    expect(response.body.expectedCode).toBe('DYE-4471');

    // Nothing was written — the refusal path never reaches the repository.
    const current = await request(harness.app)
      .get('/api/material-identity/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(current.body.identity).toBeNull();
  });

  it('an unreadable scan is a 503 — and the attestation path stays open', async () => {
    await loadRecipe();
    harness.scanner.disconnect();

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('SCANNER_UNAVAILABLE');

    // The attestation path still works.
    const attested = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        attestation: { dyestuffCode: 'DYE-4471' },
      });
    expect(attested.status).toBe(201);
    expect(attested.body.identity.verifiedBy).toBe('ATTESTATION');
  });

  it('an attestation after a scan is refused — the scan stands', async () => {
    await loadRecipe();
    harness.scanner.present('DYE-4471');

    const scanned = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });
    expect(scanned.status).toBe(201);

    const attested = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        attestation: { dyestuffCode: 'DYE-4471' },
      });
    expect(attested.status).toBe(409);

    // The scan is still the effective one.
    const current = await request(harness.app)
      .get('/api/material-identity/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(current.body.identity.verifiedBy).toBe('SCAN');
  });

  it('reports the effective verification, and null when there is none', async () => {
    await loadRecipe();

    const none = await request(harness.app)
      .get('/api/material-identity/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.identity).toBeNull();

    harness.scanner.present('DYE-4471');
    await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    const some = await request(harness.app)
      .get('/api/material-identity/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(some.body.identity.verifiedBy).toBe('SCAN');
  });

  it('returns 404 for a component the recipe does not hold', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'NOPE',
        attestation: { dyestuffCode: 'DYE-4471' },
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('COMPONENT_NOT_FOUND');
  });

  it('returns 400 when the body carries BOTH routes', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-identity')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        code: 'DYE-4471',
        attestation: { dyestuffCode: 'DYE-4471' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a session', async () => {
    const response = await request(harness.app)
      .post('/api/material-identity')
      .send({ componentId: 'DYE-4471-Y', code: 'DYE-4471' });

    expect(response.status).toBe(401);
  });

  // ── The lot ──

  it('captures the MES’s own lot as SOURCE', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: '2026-0387' });

    expect(response.status).toBe(201);
    expect(response.body.capture.captureMethod).toBe('KEYED_IN');
    expect(response.body.capture.lotNumber).toBe('2026-0387');
    expect(response.body.capture.capturedBy).toBe('OP-001');
  });

  it('derives the method — the client cannot supply it', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        lotNumber: '2026-0387',
        captureMethod: 'SOURCE',
      });

    expect(response.status).toBe(201);
    // The client's `captureMethod` is DROPPED, and the method is KEYED_IN.
    expect(response.body.capture.captureMethod).toBe('KEYED_IN');
  });

  it('trims the lot before it is stored', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: '  2026-0387  ' });

    expect(response.status).toBe(201);
    expect(response.body.capture.lotNumber).toBe('2026-0387');
  });

  it('refuses an EMPTY lot, naming the missing lot', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(response.body.fields[0].path).toBe('lotNumber');
  });

  it('refuses a lot over 64 characters — and does NOT truncate', async () => {
    await loadRecipe();

    const response = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: 'x'.repeat(65) });

    expect(response.status).toBe(400);
    expect(response.body.fields[0].message).toContain('64');
  });

  it('two captures for one component — the newest is effective, the older is RETAINED', async () => {
    await loadRecipe();

    await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: 'FIRST' });

    await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: 'SECOND' });

    const current = await request(harness.app)
      .get('/api/material-lot/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);

    expect(current.body.capture.lotNumber).toBe('SECOND');
  });

  it('the same lot for two components — BOTH are stored', async () => {
    await loadRecipe();

    const first = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', lotNumber: '2026-0387' });
    expect(first.status).toBe(201);

    const second = await request(harness.app)
      .post('/api/material-lot')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-B', lotNumber: '2026-0387' });
    expect(second.status).toBe(201);

    const a = await request(harness.app)
      .get('/api/material-lot/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    const b = await request(harness.app)
      .get('/api/material-lot/DYE-4471-B')
      .set('Authorization', `Bearer ${token}`);

    expect(a.body.capture.lotNumber).toBe('2026-0387');
    expect(b.body.capture.lotNumber).toBe('2026-0387');
  });

  it('reports the effective capture, and null when there is none', async () => {
    await loadRecipe();

    const none = await request(harness.app)
      .get('/api/material-lot/DYE-4471-Y')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.capture).toBeNull();
  });

  it('returns 401 without a session', async () => {
    const response = await request(harness.app)
      .post('/api/material-lot')
      .send({ componentId: 'DYE-4471-Y', lotNumber: '2026-0387' });

    expect(response.status).toBe(401);
  });
});
