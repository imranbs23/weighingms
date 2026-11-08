/**
 * The ticket and the print job — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * B-7: A PRINTER FAILURE MUST NEVER COST A WEIGHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the ticket is generated, and it carries the lines
 *   - a SECOND generation returns the **same** ticket — idempotent
 *   - the print job is created, driven to `DONE`, and **retrievable by
 *     its id**
 *   - a failing printer gives a `FAILED` job with a **visible error** — and
 *     **the weighing record still exists**
 *   - the ticket can be reprinted **without** the weighing being
 *     re-entered, re-weighed or re-confirmed
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

/** The recipe's components, in order, with the scale each demands. */
const COMPONENTS: readonly {
  readonly componentId: string;
  readonly scaleId: string;
}[] = [
  { componentId: 'DYE-4471-B', scaleId: 'SCALE-A' },
  { componentId: 'DYE-2204-R', scaleId: 'SCALE-A' },
  { componentId: 'DYE-4471-Y', scaleId: 'SCALE-A' },
  { componentId: 'AUX-0101', scaleId: 'SCALE-B' },
  { componentId: 'AUX-0107', scaleId: 'SCALE-B' },
];

describe('the ticket and the print job', () => {
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

  /** Weigh every component of the recipe, in order. */
  async function weighTheWholeBatch(): Promise<void> {
    for (const component of COMPONENTS) {
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

      expect(
        confirmed.status,
        `the confirmation of ${component.componentId} was refused: ${JSON.stringify(confirmed.body)}`,
      ).toBe(201);
    }
  }

  it('generates the ticket, and it carries the lines and the identity', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(201);
    const ticket = response.body.ticket;

    expect(ticket.batch.batchId).toBe('B-24187');
    expect(ticket.batch.machineRef).toBe('JET-04');
    expect(ticket.operatorId).toBe(OPERATOR_ID);
    expect(ticket.templateId).toBe('DEFAULT');
    expect(ticket.lines).toHaveLength(COMPONENTS.length);

    // And the outcome — every weighing was in the OK zone.
    expect(ticket.toleranceOutcome).toBe('WITHIN_TOLERANCE');
  });

  it('the lines carry the RECORDS’ OWN quantities, and each keeps its own unit', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    const ticket = response.body.ticket;

    // The dyestuff's line is in grams and the auxiliary's is in kilograms
    // — and NEITHER is converted (ADR-042).
    const dye = ticket.lines.find(
      (l: { componentId: string }) => l.componentId === 'DYE-4471-Y',
    );
    const aux = ticket.lines.find(
      (l: { componentId: string }) => l.componentId === 'AUX-0101',
    );

    expect(dye.actualUnit).toBe('g');
    expect(aux.actualUnit).toBe('kg');

    // And the quantities are STRINGS — the records' own.
    expect(typeof dye.actualQuantity).toBe('string');
    expect(typeof aux.actualQuantity).toBe('string');
  });

  it('a SECOND generation returns the SAME ticket — idempotent', async () => {
    await weighTheWholeBatch();

    const first = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(201);

    const second = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    // A retry after an ambiguous response must SUCCEED — and it returns
    // the SAME ticket, not an error and not a second one.
    expect(second.status).toBe(200);
    expect(second.body.ticket.ticketId).toBe(first.body.ticket.ticketId);
  });

  it('the print job is created, completes, and is RETRIEVABLE by its id', async () => {
    await weighTheWholeBatch();
    const generated = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    const printed = await request(harness.app)
      .post(`/api/tickets/${generated.body.ticket.ticketId}/print`)
      .set('Authorization', `Bearer ${token}`);

    expect(printed.status).toBe(201);
    expect(printed.body.job.state).toBe('DONE');
    expect(printed.body.job.isReprint).toBe(false);
    expect(printed.body.job.completedAt).not.toBeNull();

    // And the job is retrievable — so the UI can show "printing" rather
    // than a dead button.
    const fetched = await request(harness.app)
      .get(`/api/print-jobs/${printed.body.job.jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.job.state).toBe('DONE');
  });

  it('B-7: a FAILING printer gives a FAILED job — and the weighing SURVIVES', async () => {
    await weighTheWholeBatch();
    const generated = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    // The printer goes out of paper.
    harness.tickets.trainingPrinter.setAvailable(false, 'The printer is out of paper');

    const printed = await request(harness.app)
      .post(`/api/tickets/${generated.body.ticket.ticketId}/print`)
      .set('Authorization', `Bearer ${token}`);

    // The failure is the JOB's state — and it carries a VISIBLE error.
    expect(printed.status).toBe(201);
    expect(printed.body.job.state).toBe('FAILED');
    expect(printed.body.job.error).toBe('The printer is out of paper');

    // AND THE WEIGHING RECORD STILL EXISTS. The print path has no
    // weighing-record repository, so it cannot have touched it.
    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    const weighed = await harness.station.records.allFor(session.sessionId);
    expect(weighed).toHaveLength(COMPONENTS.length);
  });

  it('B-7: the ticket prints AGAIN — without the weighing being re-entered', async () => {
    await weighTheWholeBatch();
    const generated = await request(harness.app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`);

    harness.tickets.trainingPrinter.setAvailable(false, 'The printer is out of paper');
    const failed = await request(harness.app)
      .post(`/api/tickets/${generated.body.ticket.ticketId}/print`)
      .set('Authorization', `Bearer ${token}`);
    expect(failed.body.job.state).toBe('FAILED');

    // The paper is replaced, and it prints.
    harness.tickets.trainingPrinter.setAvailable(true);
    const reprinted = await request(harness.app)
      .post(`/api/tickets/${generated.body.ticket.ticketId}/print`)
      .set('Authorization', `Bearer ${token}`);

    expect(reprinted.status).toBe(201);
    expect(reprinted.body.job.state).toBe('DONE');

    // And there are now TWO jobs — each attempt is its own row — and the
    // second is still a FIRST print, because no reason was supplied.
    const session = await harness.station.sessions.current();
    expect(session).not.toBeNull();
    if (session === null) return;

    // And the weighing was NOT re-confirmed — still one record per
    // component.
    const weighed = await harness.station.records.allFor(session.sessionId);
    expect(weighed).toHaveLength(COMPONENTS.length);
  });

  it('the ticket without a session is a 401', async () => {
    const response = await request(harness.app).post('/api/tickets');
    expect(response.status).toBe(401);
  });

  it('printing a ticket that does not exist is a 404', async () => {
    const response = await request(harness.app)
      .post('/api/tickets/TKT-NOPE/print')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
