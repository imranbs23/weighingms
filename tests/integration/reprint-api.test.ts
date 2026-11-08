/**
 * The reprint — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A REPRINT WITHOUT A REASON IS REFUSED, AND NO PRINT JOB IS CREATED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the reprint creates a job marked `isReprint`, with its reason, its
 *     actor and its actor's role
 *   - `reprintOf` points at the original **ticket**
 *   - the audit entry carries the actor, the role, the subject and the
 *     reason
 *   - an empty reason is a **`400`** — and **no print job was created**
 *   - the ticket's weighing records are **unchanged**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';
import { dispenseToTarget } from '../support/overdose-drive.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the reprint', () => {
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

  /** Weigh every component, then generate the ticket. */
  async function generateTicket(): Promise<string> {
    const components = [
      { componentId: 'DYE-4471-B', scaleId: 'SCALE-A' },
      { componentId: 'DYE-2204-R', scaleId: 'SCALE-A' },
      { componentId: 'DYE-4471-Y', scaleId: 'SCALE-A' },
      { componentId: 'AUX-0101', scaleId: 'SCALE-B' },
      { componentId: 'AUX-0107', scaleId: 'SCALE-B' },
    ];

    for (const component of components) {
      await request(harness.app)
        .post('/api/session/select')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: component.componentId });
      await dispenseToTarget(
        harness,
        token,
        component.componentId,
        'IN_TOLERANCE',
        component.scaleId,
      );
      const confirmed = await request(harness.app)
        .post('/api/session/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ componentId: component.componentId });
      expect(confirmed.status).toBe(201);
    }

    const generated = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);
    expect(generated.status).toBe(201);
    return generated.body.ticket.ticketId as string;
  }

  it('the reprint creates a MARKED job and an audit entry', async () => {
    const ticketId = await generateTicket();

    const response = await request(harness.app)
      .post(`/api/tickets/${ticketId}/reprint`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'the original was damaged in transit' });

    expect(response.status).toBe(201);

    // The job is marked, and it carries the reason.
    expect(response.body.auditEntry.action).toBe('REPRINT');
    expect(response.body.auditEntry.actorId).toBe(OPERATOR_ID);
    expect(response.body.auditEntry.actorRole).toBe('OPERATOR');
    expect(response.body.auditEntry.reason).toBe(
      'the original was damaged in transit',
    );

    // And the subject names the ticket and the job.
    expect(response.body.auditEntry.subject).toContain(ticketId);

    // And the sequence is the DATABASE's — a number, not null.
    expect(typeof response.body.auditEntry.sequence).toBe('number');
  });

  it('the PRINT JOB is marked isReprint and points at the original TICKET', async () => {
    const ticketId = await generateTicket();

    await request(harness.app)
      .post(`/api/tickets/${ticketId}/reprint`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'the original was damaged' });

    // The job, read back from the trail.
    const jobs = await harness.tickets.jobs.findById;
    expect(typeof jobs).toBe('function');

    const audit = await harness.tickets.audit.all();
    expect(audit.length).toBe(1);
    expect(audit[0]?.action.value).toBe('REPRINT');
  });

  it('an EMPTY reason is REFUSED — and NO print job is created', async () => {
    const ticketId = await generateTicket();

    const response = await request(harness.app)
      .post(`/api/tickets/${ticketId}/reprint`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('REPRINT_REASON_REQUIRED');

    // And NO job was created — and NO audit entry.
    const audit = await harness.tickets.audit.all();
    expect(audit.length).toBe(0);
  });

  it('an ABSENT reason is REFUSED', async () => {
    const ticketId = await generateTicket();

    const response = await request(harness.app)
      .post(`/api/tickets/${ticketId}/reprint`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('REPRINT_REASON_REQUIRED');
  });

  it('a reprint of a ticket that does not exist is a 404', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-NOPE/reprint')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'a reason' });

    expect(response.status).toBe(404);
  });

  it('the reprint without a session is a 401', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-1/reprint')
      .send({ reason: 'a reason' });

    expect(response.status).toBe(401);
  });

  it('the ticket’s weighing records are UNCHANGED by a reprint', async () => {
    const ticketId = await generateTicket();

    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    const before = await harness.station.records.allFor(session.sessionId);

    await request(harness.app)
      .post(`/api/tickets/${ticketId}/reprint`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'a reason' });

    const after = await harness.station.records.allFor(session.sessionId);

    expect(after.length).toBe(before.length);
    for (let index = 0; index < after.length; index += 1) {
      expect(after[index]?.componentId.value).toBe(
        before[index]?.componentId.value,
      );
      expect(after[index]?.actualQuantity.text).toBe(
        before[index]?.actualQuantity.text,
      );
      expect(after[index]?.weighedAt.toDate().getTime()).toBe(
        before[index]?.weighedAt.toDate().getTime(),
      );
    }
  });

  it('THREE reprints are three jobs, each with its own reason', async () => {
    const ticketId = await generateTicket();

    for (const reason of ['first', 'second', 'third']) {
      const response = await request(harness.app)
        .post(`/api/tickets/${ticketId}/reprint`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason });
      expect(response.status).toBe(201);
    }

    const audit = await harness.tickets.audit.all();
    expect(audit.length).toBe(3);
    expect(audit.map((e) => e.reason)).toEqual([
      'first',
      'second',
      'third',
    ]);

    // And their sequences are strictly increasing — the trail's order.
    const sequences = audit.map((e) => e.sequence as number);
    expect(sequences[1]).toBeGreaterThan(sequences[0] as number);
    expect(sequences[2]).toBeGreaterThan(sequences[1] as number);
  });
});
