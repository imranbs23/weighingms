/**
 * The zone and the confirmation — security.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT CANNOT ASSERT THE ZONE, THE QUANTITY, OR THE FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This repository's security review is manual, against the requirements and
 * the ADRs in `memory-bank/`, and this file is the executable part of that
 * review for unit 003's zone and confirmation.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the endpoints require an operator session (ADR-020)
 *   - a client-supplied zone is DROPPED — the domain decides
 *   - a client-supplied actual quantity is DROPPED — the device decides
 *   - a client-supplied target or tolerance is DROPPED — the recipe decides
 *   - the diagnostics never reach the client (BRD IR-09)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingRecord } from '../../src/003-weighing-station/domain/entities/weighing-record.js';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the zone and the confirmation — security', () => {
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

  it('refuses the zone without a session', async () => {
    const response = await request(harness.app).get('/api/session/zone');
    expect(response.status).toBe(401);
  });

  it('refuses the confirmation with a MALFORMED token', async () => {
    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ componentId: 'DYE-4471-Y' });

    expect(response.status).toBe(401);
  });

  it('DROPS a client-supplied zone', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y', zone: 'OK' });

    // The `zone` field does not exist, so it is stripped — and the gate
    // reads the DOMAIN's zone, which is `null` because no reading has
    // arrived.
    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('NO_READING');
    expect(response.body.zone).toBeNull();
  });

  it('DROPS a client-supplied actual quantity', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        actualQuantity: '94.0000',
        unit: 'g',
      });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('NO_READING');
  });

  it('DROPS a client-supplied target and tolerance', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/session/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentId: 'DYE-4471-Y',
        target: '1.0000',
        tolerance: '0.5000',
        zone: 'OK',
      });

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe('NO_READING');
  });

  it('never leaks the diagnostic to the client', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(harness.app)
        .post('/api/session/select')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: 'DYE-4471-Y' });

      const response = await request(harness.app)
        .post('/api/session/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: 'DYE-4471-Y' });

      expect(response.status).toBe(409);
      // The body carries the reason CODE, not a sentence and not the
      // component id.
      expect(Object.keys(response.body).sort()).toEqual([
        'error',
        'reason',
        'zone',
      ]);
      expect(response.text).not.toContain('DYE-4471-Y');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('the weighing record is IMMUTABLE in the database', async () => {
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    // A record is written through the repository — the **same** path the
    // gate uses — so the trigger has a row to refuse.
    harness.station.records.save(
      new WeighingRecord(
        'REC-1',
        'WS-1',
        ComponentId.create('DYE-4471-Y'),
        WeightValue.of('94.2400', 'g'),
        WeightValue.of('94.0000', 'g'),
        null,
        'OK',
        ScaleId.create('SCALE-A'),
        'PRECISION',
        null,
        null,
        OperatorId.create('OP-001'),
        Instant.of(new Date('2026-11-06T09:14:22.000Z')),
      ),
    );

    // The trigger is the enforcement, not the repository's convention.
    expect(() =>
      harness.identity.db
        .prepare(`UPDATE weighing_records SET actual_quantity = '0.0000'`)
        .run(),
    ).toThrow(/append-only/);

    expect(() =>
      harness.identity.db.prepare(`DELETE FROM weighing_records`).run(),
    ).toThrow(/append-only/);
  });
});
