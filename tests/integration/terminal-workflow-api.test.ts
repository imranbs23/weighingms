/**
 * The terminal's workflow — the API the operator UI drives (bolt 029).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATION DECIDES THE COMPONENT. THE CLIENT SAYS ONLY WHICH BATCH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Starting a batch binds the FIRST component's scale; a confirm that
 * advances binds the NEXT one's — the 3 kg → 32 kg switch; the training
 * dispense pours the recipe's own target; a re-tare zeroes against the
 * platform; the idle devices stay READY; the scanner and the printer report
 * their own state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHarness, seedOperator, type Harness } from '../harness.js';

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

describe('the terminal workflow', () => {
  let harness: Harness;
  let token: string;

  const api = (method: 'get' | 'post', path: string) =>
    request(harness.app)[method](path).set('Authorization', `Bearer ${token}`);

  /** Wait until the API's zone is the one wanted. */
  async function zoneBecomes(wanted: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const zone = await api('get', '/api/session/zone');
      if (zone.body.zone === wanted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`the zone never became ${wanted}`);
  }

  /** Pour the active component into tolerance and confirm it. */
  async function pourAndConfirm(): Promise<request.Response> {
    const session = await api('get', '/api/session');
    const active = session.body.session.activeComponentId as string;
    await api('post', '/api/session/training/dispense').send({
      landing: 'IN_TOLERANCE',
    });
    await zoneBecomes('OK');
    return api('post', '/api/session/confirm').send({ componentId: active });
  }

  beforeEach(async () => {
    harness = createHarness({ sampleIntervalMs: 20 });
    await seedOperator(harness, OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  describe('starting a batch', () => {
    it('the station selects the FIRST component in recipe order and binds its scale', async () => {
      await api('get', '/api/recipe/B-24187');
      const started = await api('post', '/api/session/start').send({
        batchId: 'B-24187',
      });

      expect(started.status).toBe(200);
      expect(started.body.session.batchId).toBe('B-24187');
      expect(started.body.session.activeComponentId).toBe('DYE-4471-B');
      expect(started.body.session.selectedScaleId).toBe('SCALE-A');
    });

    it('starting AGAIN continues the same session — it is a resume, not a restart', async () => {
      await api('get', '/api/recipe/B-24187');
      const first = await api('post', '/api/session/start').send({ batchId: 'B-24187' });
      const again = await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      expect(again.status).toBe(200);
      expect(again.body.session.sessionId).toBe(first.body.session.sessionId);
    });

    it('a batch whose recipe is not loaded is REFUSED — the station starts nothing', async () => {
      await api('get', '/api/recipe/B-24187');
      const started = await api('post', '/api/session/start').send({
        batchId: 'B-24188',
      });

      expect(started.status).toBe(409);
      expect(started.body.error).toBe('RECIPE_NOT_LOADED');
    });

    it('requires an operator session', async () => {
      const started = await request(harness.app)
        .post('/api/session/start')
        .send({ batchId: 'B-24187' });
      expect(started.status).toBe(401);
    });
  });

  describe('the progression', () => {
    it('a confirm that ADVANCES binds the next component — and Sodium Sulphate gets the 32 kg scale', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      // Blue RSPL, Red RB, Yellow RGB — the 3 kg precision scale.
      for (const expectedNext of ['DYE-2204-R', 'DYE-4471-Y', 'AUX-0101']) {
        const confirmed = await pourAndConfirm();
        expect(confirmed.status).toBe(201);
        expect(confirmed.body.advancedTo).toBe(expectedNext);
        expect(confirmed.body.batchComplete).toBe(false);
      }

      // THE SWITCH — bound by the station, without a select from the client.
      const session = await api('get', '/api/session');
      expect(session.body.session.activeComponentId).toBe('AUX-0101');
      expect(session.body.session.selectedScaleId).toBe('SCALE-B');
      expect(session.body.session.state).toBe('WEIGHING');
    });

    it('a COMPLETED batch’s session is never continued — starting again starts a new one', async () => {
      await api('get', '/api/recipe/B-24187');
      const first = await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      for (let index = 0; index < 5; index += 1) {
        const confirmed = await pourAndConfirm();
        expect(confirmed.status).toBe(201);
      }
      const completed = await api('post', '/api/batch/B-24187/complete');
      expect(completed.status).toBe(200);
      expect(completed.body.summary.writeBack).toBe('CONFIRMED');

      await api('get', '/api/recipe/B-24187');
      const again = await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      expect(again.status).toBe(200);
      expect(again.body.session.sessionId).not.toBe(first.body.session.sessionId);
      expect(again.body.session.counter.weighed).toBe(0);
    });

    it('a new component starts from an EMPTY platform — the last weight never shows against it', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });
      await pourAndConfirm();

      // Red RB's target is 386 g; Blue's 1240 g must not be on the scale.
      const zone = await api('get', '/api/session/zone');
      expect(['UNDER', null]).toContain(zone.body.zone);
    });
  });

  describe('the training dispense', () => {
    it('pours the RECIPE’s target — the client sends only the landing', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      const poured = await api('post', '/api/session/training/dispense').send({
        landing: 'IN_TOLERANCE',
      });
      expect(poured.status).toBe(202);
      await zoneBecomes('OK');
    });

    it('OVERSHOOT lands OVER tolerance — and the confirm is refused', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });

      await api('post', '/api/session/training/dispense').send({
        landing: 'OVER_TOLERANCE',
      });
      await zoneBecomes('OVER');

      const confirmed = await api('post', '/api/session/confirm').send({
        componentId: 'DYE-4471-B',
      });
      expect(confirmed.status).toBe(409);
      expect(confirmed.body.reason).toBe('ZONE_OVER');
    });

    it('with no active component, there is nothing to pour', async () => {
      const poured = await api('post', '/api/session/training/dispense').send({
        landing: 'IN_TOLERANCE',
      });
      expect(poured.status).toBe(409);
      expect(poured.body.error).toBe('NO_ACTIVE_COMPONENT');
    });

    it('a landing that is not one of the two is a 400', async () => {
      const poured = await api('post', '/api/session/training/dispense').send({
        landing: 'SOMEWHERE',
      });
      expect(poured.status).toBe(400);
    });
  });

  describe('the re-tare', () => {
    it('zeroes the net reading against what is on the platform', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });
      await api('post', '/api/session/training/dispense').send({
        landing: 'IN_TOLERANCE',
      });
      await zoneBecomes('OK');

      const tared = await api('post', '/api/scales/SCALE-A/re-tare');
      expect(tared.status).toBe(202);
      expect(tared.body.tare.source).toBe('WEIGHED_EMPTY_CONTAINER');

      // The platform's weight is now the tare — and the zone falls back.
      await zoneBecomes('UNDER');
    });

    it('after a re-tare, a dispense still lands the NET reading in tolerance', async () => {
      await api('get', '/api/recipe/B-24187');
      await api('post', '/api/session/start').send({ batchId: 'B-24187' });
      await api('post', '/api/session/training/dispense').send({
        landing: 'OVER_TOLERANCE',
      });
      await zoneBecomes('OVER');

      await api('post', '/api/scales/SCALE-A/re-tare');
      await api('post', '/api/session/training/dispense').send({
        landing: 'IN_TOLERANCE',
      });
      await zoneBecomes('OK');
    });

    it('an unknown scale is a 404', async () => {
      const tared = await api('post', '/api/scales/SCALE-Z/re-tare');
      expect(tared.status).toBe(404);
    });
  });

  describe('the peripherals', () => {
    it('GET /api/scales says which devices are the training dummy', async () => {
      const scales = await api('get', '/api/scales');
      expect(
        scales.body.scales.map((scale: { source: string }) => scale.source),
      ).toEqual(['DUMMY', 'DUMMY']);
    });

    it('an IDLE scale stays connected once the devices are kept alive', async () => {
      harness.scales.keepDevicesAlive();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const scales = await api('get', '/api/scales');
      for (const scale of scales.body.scales as { link: string; status: string }[]) {
        expect(scale.link).toBe('UP');
        expect(scale.status).not.toBe('DISCONNECTED');
      }
    });

    it('the scanner reports READY, and DISCONNECTED when it is', async () => {
      expect((await api('get', '/api/scanner/status')).body).toEqual({
        state: 'READY',
        source: 'DUMMY',
      });

      harness.scanner.disconnect();
      expect((await api('get', '/api/scanner/status')).body.state).toBe(
        'DISCONNECTED',
      );
    });

    it('the printer reports READY, and UNAVAILABLE with its reason', async () => {
      expect((await api('get', '/api/printer/status')).body.state).toBe('READY');

      harness.tickets.trainingPrinter.setAvailable(false, 'Out of paper');
      const status = await api('get', '/api/printer/status');
      expect(status.body.state).toBe('UNAVAILABLE');
      expect(status.body.reason).toBe('Out of paper');
    });
  });
});
