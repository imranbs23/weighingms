/**
 * The batch's summary — through the API.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SUMMARY IS COMPUTED FROM THE RECORDS, AND THE CLIENT SUPPLIES
 * NONE OF ITS FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - an incomplete batch is a `409` — and a `summary: null` on the read
 *   - the `200` carries the counts, the total, the verdict, the elapsed
 *     time, the operator, the write-back's state and the release statement
 *   - the total is **converted and summed** — the story's worked example
 *   - the write-back's state is reported, and a `PENDING` does not
 *     un-complete the batch
 *   - a **retry** does not double-post
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

describe('the batch summary', () => {
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

  it('an INCOMPLETE batch has no summary — and that is a state, not an error', async () => {
    const response = await request(harness.app)
      .get('/api/batch/B-24187/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.summary).toBeNull();
  });

  it('completing an INCOMPLETE batch is a 409', async () => {
    // Select a component, so there IS a session — and the batch is not
    // complete.
    await request(harness.app)
      .post('/api/session/select')
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: 'DYE-4471-Y' });

    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('BATCH_NOT_COMPLETE');
  });

  it('the summary carries the batch, the counts, the operator and the release', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const summary = response.body.summary;

    expect(summary.batchId).toBe('B-24187');
    expect(summary.componentsWeighed).toBe(COMPONENTS.length);
    expect(summary.componentCount).toBe(COMPONENTS.length);
    expect(summary.operatorId).toBe(OPERATOR_ID);
    expect(summary.elapsedSeconds).toBeGreaterThanOrEqual(0);

    // The release statement, and the machine it names.
    expect(summary.releasedForTransport).toBe(true);
    expect(typeof summary.targetMachine).toBe('string');
  });

  it('the total is CONVERTED and SUMMED — in kilograms, as a string', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    const summary = response.body.summary;

    // The recipe's targets sum to 1720 g of dyestuffs and 33.6 kg of
    // auxiliaries — 35.32 kg. And each weighing landed WITHIN its
    // tolerance band, so the total is within the sum of those bands.
    expect(summary.unit).toBe('kg');
    expect(Number(summary.totalDispensed)).toBeGreaterThan(35.1);
    expect(Number(summary.totalDispensed)).toBeLessThan(35.5);

    // And it is a STRING — never a float (BRD NFR-16, C-11).
    expect(typeof summary.totalDispensed).toBe('string');

    // AND IT IS NOT A CONCATENATION. The story's warning is that the
    // display strings are joined — and a joined total would carry the
    // grams' digits after the kilograms', and would not parse as a
    // number at all.
    expect(Number.isNaN(Number(summary.totalDispensed))).toBe(false);
    expect(summary.totalDispensed).not.toContain('kg');
  });

  it('every weighing was in the OK zone — so the verdict is YES', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.summary.allWithinTolerance).toBe('YES');
  });

  it('the write-back’s state is reported', async () => {
    await weighTheWholeBatch();

    const response = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    const summary = response.body.summary;
    expect(['CONFIRMED', 'PENDING', 'FAILED']).toContain(summary.writeBack);
    if (summary.writeBack === 'CONFIRMED') {
      expect(typeof summary.writeBackConfirmedAt).toBe('string');
    }
  });

  it('a RETRY does not double-post — the idempotency is unit 005’s', async () => {
    await weighTheWholeBatch();

    const first = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    const second = await request(harness.app)
      .post('/api/batch/B-24187/complete')
      .set('Authorization', `Bearer ${token}`);

    // The retry succeeds, and the summary is the same.
    expect(second.status).toBe(200);
    expect(second.body.summary.totalDispensed).toBe(
      first.body.summary.totalDispensed,
    );
  });

  it('the summary without a session is a 401', async () => {
    const response = await request(harness.app).get(
      '/api/batch/B-24187/summary',
    );
    expect(response.status).toBe(401);
  });
});
