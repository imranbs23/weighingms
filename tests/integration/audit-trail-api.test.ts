/**
 * The audit trail's query and export — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * READING THE TRAIL IS A SUPERVISOR'S ACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - an **operator** is refused — a `403`
 *   - a **supervisor** gets the matching entries, in sequence order
 *   - the export's body is `JSONL`, and it parses
 *   - the export carries **every field**
 *   - an empty filter produces an **empty** export and **not** an error
 *   - no session is a `401`
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
const SUPERVISOR_ID = 'OP-SUP-001';
const SUPERVISOR_SECRET = '9931';

describe('the audit trail', () => {
  let harness: Harness;
  let operatorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    await seedOperator(
      harness,
      SUPERVISOR_ID,
      'S. Aziz',
      'SUPERVISOR',
      SUPERVISOR_SECRET,
    );

    const operatorSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    operatorToken = operatorSignIn.body.token as string;

    const supervisorSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: SUPERVISOR_ID, secret: SUPERVISOR_SECRET });
    supervisorToken = supervisorSignIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  /** Record a privileged action straight into the trail. */
  async function recordEntry(entryId: string, actorId = SUPERVISOR_ID) {
    const { AuditAction, AuditEntry, AuditSubject } = await import(
      '../../src/006-ticket-printing/domain/entities/audit-entry.js'
    );
    const { Instant } = await import(
      '../../src/004-scale-integration/domain/value-objects/instant.js'
    );

    await harness.tickets.audit.record(
      new AuditEntry({
        entryId,
        action: AuditAction.of('REPRINT'),
        actorId,
        actorRole: 'SUPERVISOR',
        subject: AuditSubject.create(`ticket=TKT-1;job=JOB-${entryId}`),
        reason: 'the original was damaged',
        occurredAt: Instant.of(new Date('2026-11-06T11:30:00.000Z')),
      }),
    );
  }

  it('an OPERATOR is refused — the trail is a supervisor’s record', async () => {
    await recordEntry('E1');

    const response = await request(harness.app)
      .get('/api/audit/trail')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('SUPERVISOR_REQUIRED');
  });

  it('the EXPORT is refused for an operator too', async () => {
    const response = await request(harness.app)
      .get('/api/audit/trail/export')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(403);
  });

  it('a SUPERVISOR gets the matching entries, in sequence order', async () => {
    await recordEntry('E1');
    await recordEntry('E2');
    await recordEntry('E3');

    const response = await request(harness.app)
      .get('/api/audit/trail')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(3);
    expect(response.body.hasMore).toBe(false);

    // In SEQUENCE order.
    const sequences = response.body.entries.map(
      (e: { sequence: number }) => e.sequence,
    );
    expect(sequences[1]).toBeGreaterThan(sequences[0] as number);
    expect(sequences[2]).toBeGreaterThan(sequences[1] as number);
  });

  it('the query filters by actor', async () => {
    await recordEntry('E1', 'OP-SUP-001');
    await recordEntry('E2', 'OP-OTHER');

    const response = await request(harness.app)
      .get('/api/audit/trail?actorId=OP-SUP-001')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0].entryId).toBe('E1');
  });

  it('the export is JSONL, and it PARSES', async () => {
    await recordEntry('E1');
    await recordEntry('E2');

    const response = await request(harness.app)
      .get('/api/audit/trail/export')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');

    // One JSON object per line — and each one parses.
    const lines = response.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('the export carries EVERY field', async () => {
    await recordEntry('E1');

    const response = await request(harness.app)
      .get('/api/audit/trail/export')
      .set('Authorization', `Bearer ${supervisorToken}`);

    const entry = JSON.parse(response.text.trim());

    expect(entry.sequence).toBeGreaterThan(0);
    expect(entry.entryId).toBe('E1');
    expect(entry.action).toBe('REPRINT');
    expect(entry.actorId).toBe(SUPERVISOR_ID);
    expect(entry.actorRole).toBe('SUPERVISOR');
    expect(entry.subject).toContain('TKT-1');
    expect(entry.reason).toBe('the original was damaged');
    expect(entry.occurredAt).toBe('2026-11-06T11:30:00.000Z');
  });

  it('an EMPTY export is a VALID export — not an error', async () => {
    const response = await request(harness.app)
      .get('/api/audit/trail/export?actorId=OP-NOBODY')
      .set('Authorization', `Bearer ${supervisorToken}`);

    expect(response.status).toBe(200);
    expect(response.text.trim()).toBe('');
  });

  it('the trail without a session is a 401', async () => {
    const response = await request(harness.app).get('/api/audit/trail');
    expect(response.status).toBe(401);
  });

  it('the export without a session is a 401', async () => {
    const response = await request(harness.app).get('/api/audit/trail/export');
    expect(response.status).toBe(401);
  });
});
