/**
 * Integration tests for the authorisation HTTP endpoints.
 *
 * ADR-004 is the contract under test here: there are TWELVE ways to refuse
 * a privileged action, and the caller receives ONE status and ONE body for
 * every one of them. A precise error would be a map of the defences — a
 * refusal that names its cause confirms the credential was accepted.
 *
 * The named reason still goes to the AUDIT TRAIL. The HTTP response does
 * not. That split is the decision this file proves.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  buildIdentityModule,
  type IdentityModule,
} from '../../src/008-operator-identity/infrastructure/composition-root.js';
import type { IdentityConfig } from '../../src/008-operator-identity/infrastructure/config/identity-config.js';
import { createApp } from '../../src/api/app.js';
import { buildScaleModule } from '../../src/004-scale-integration/infrastructure/composition-root.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { Operator } from '../../src/008-operator-identity/domain/entities/operator.js';
import { createOrgatexHarness } from '../support/orgatex-harness.js';

const OPERATOR_ID = 'OP-001';
const SUPERVISOR_ID = 'SV-001';
const OPERATOR_SECRET = '4821';
const SUPERVISOR_SECRET = '9931';

const REFUSED_BODY = { error: 'AUTHORISATION_REFUSED' };

class Harness {
  readonly module: IdentityModule;
  readonly app: ReturnType<typeof createApp>;

  constructor() {
    const config: IdentityConfig = {
      databasePath: ':memory:',
      sessionLifetimeMs: 8 * 60 * 60 * 1000,
      argon2Memory: 8192,
      argon2Passes: 1,
      authorisationLifetimeMs: 15 * 60 * 1000,
    };
    this.module = buildIdentityModule({ config });
    this.app = createApp({
      identity: this.module,
      scales: buildScaleModule({
        config: {
          databasePath: ':memory:',
          disconnectTimeoutMs: 2000,
          sampleIntervalMs: 100,
          selectionThreshold: null,
        },
        db: this.module.db,
      }),
      orgatex: createOrgatexHarness(),
    });
  }

  async seed(
    id: string,
    displayName: string,
    role: 'OPERATOR' | 'SUPERVISOR',
    secret: string,
  ): Promise<void> {
    const operatorId = OperatorId.create(id);
    const operator = new Operator(
      operatorId,
      displayName,
      role === 'SUPERVISOR' ? OperatorRole.supervisor() : OperatorRole.operator(),
      true,
      new Date(),
    );
    await this.module.operatorRepository.save(operator);
    await this.module.credentials.create(operatorId, operator.role, secret);
  }

  close(): void {
    this.module.close();
  }
}

let harness: Harness;
let operatorToken: string;

beforeEach(async () => {
  harness = new Harness();
  await harness.seed(OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
  await harness.seed(SUPERVISOR_ID, 'S. Ahmed', 'SUPERVISOR', SUPERVISOR_SECRET);

  const signIn = await request(harness.app)
    .post('/api/identity/sign-in')
    .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
  operatorToken = signIn.body.token;
});

afterEach(() => {
  harness.close();
});

/** POST /api/identity/authorisations with the operator's session. */
function authorise(body: Record<string, unknown> = {}) {
  return request(harness.app)
    .post('/api/identity/authorisations')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({
      supervisorId: SUPERVISOR_ID,
      secret: SUPERVISOR_SECRET,
      action: 'CONFIRM_COMPONENT',
      subject: 'comp-1',
      reason: 'Approved per QC hold',
      ...body,
    });
}

describe('POST /api/identity/authorisations', () => {
  it('creates an authorisation and returns 201', async () => {
    const res = await authorise();

    expect(res.status).toBe(201);
    expect(res.body.authorisationId).toBeTruthy();
    expect(res.body.supervisorId).toBe(SUPERVISOR_ID);
    expect(res.body.action).toBe('CONFIRM_COMPONENT');
    expect(res.body.subject).toBe('comp-1');
    expect(res.body.reason).toBe('Approved per QC hold');
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('returns the IDENTICAL refusal body for EVERY cause', async () => {
    // ADR-004: one status, one body — for all twelve refusal causes.
    //
    // NOTE: a MALFORMED body is excluded here. It is the ONE deliberate
    // exception (400 VALIDATION_ERROR) and is asserted separately below.
    const causes: Record<string, unknown>[] = [
      { supervisorId: 'SV-999' },                        // no such supervisor
      { secret: '0000' },                                // wrong secret
      { reason: '' },                                    // missing reason
      { reason: '!!!' },                                 // meaningless reason
      { supervisorId: OPERATOR_ID, secret: OPERATOR_SECRET }, // not a supervisor
    ];

    const bodies: string[] = [];
    const statuses: number[] = [];

    for (const cause of causes) {
      const res = await authorise(cause);
      statuses.push(res.status);
      bodies.push(JSON.stringify(res.body));
    }

    for (const status of statuses) {
      expect(status).toBe(403);
    }
    for (const body of bodies) {
      expect(body).toBe(JSON.stringify(REFUSED_BODY));
    }
  });

  it('refuses with 403 and the generic body — never names the cause', async () => {
    const res = await authorise({ secret: '0000' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED_BODY);
    // The body must not leak WHICH control failed.
    expect(JSON.stringify(res.body)).not.toContain('AUTHENTICATION');
    expect(JSON.stringify(res.body)).not.toContain('SELF');
    expect(JSON.stringify(res.body)).not.toContain('SUPERVISOR');
  });

  it('rejects a MALFORMED request with 400 VALIDATION_ERROR', async () => {
    // The ONE deliberate exception: a malformed request describes the
    // request's shape, which the caller already knows, and is rejected
    // BEFORE the credential store is consulted.
    const res = await authorise({ action: 'NOT_A_PRIVILEGED_ACTION' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('AUTHORISATION_REFUSED');
  });

  it('requires a signed-in operator', async () => {
    const res = await request(harness.app)
      .post('/api/identity/authorisations')
      .send({
        supervisorId: SUPERVISOR_ID,
        secret: SUPERVISOR_SECRET,
        action: 'CONFIRM_COMPONENT',
        subject: 'comp-1',
        reason: 'Approved per QC hold',
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
  });
});

describe('GET /api/identity/authorisations/:id', () => {
  it('returns the authorisation to the operator it was issued for', async () => {
    const created = await authorise();

    const res = await request(harness.app)
      .get(`/api/identity/authorisations/${created.body.authorisationId}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authorisationId).toBe(created.body.authorisationId);
    expect(res.body.reason).toBe('Approved per QC hold');
    expect(res.body.consumed).toBe(false);
  });

  it('refuses the SUPERVISOR reading their own authorisation', async () => {
    // The authorisation is FOR the requesting operator — the supervisor
    // reading it back would expose their own justification text, which
    // is exactly what the generic refusal prevents.
    const created = await authorise();

    const supervisorSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: SUPERVISOR_ID, secret: SUPERVISOR_SECRET });

    const res = await request(harness.app)
      .get(`/api/identity/authorisations/${created.body.authorisationId}`)
      .set('Authorization', `Bearer ${supervisorSignIn.body.token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED_BODY);
  });

  it('refuses a DIFFERENT operator', async () => {
    const created = await authorise();
    await harness.seed('OP-002', 'T. Hossain', 'OPERATOR', '1234');

    const otherSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-002', secret: '1234' });

    const res = await request(harness.app)
      .get(`/api/identity/authorisations/${created.body.authorisationId}`)
      .set('Authorization', `Bearer ${otherSignIn.body.token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED_BODY);
  });

  it('returns 404 for an unknown authorisation', async () => {
    const res = await request(harness.app)
      .get('/api/identity/authorisations/does-not-exist')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(res.status).toBe(404);
  });

  it('requires a signed-in operator', async () => {
    const created = await authorise();
    const res = await request(harness.app).get(
      `/api/identity/authorisations/${created.body.authorisationId}`,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/identity/authorisations/:id/consume', () => {
  it('spends the authorisation and returns 200', async () => {
    const created = await authorise();

    const res = await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    expect(res.status).toBe(200);
    expect(res.body.authorisationId).toBe(created.body.authorisationId);
    expect(res.body.action).toBe('CONFIRM_COMPONENT');
    expect(res.body.consumedAt).toBeTruthy();
  });

  it('refuses a SECOND consume with the generic body', async () => {
    const created = await authorise();
    const path = `/api/identity/authorisations/${created.body.authorisationId}/consume`;

    await request(harness.app)
      .post(path)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    const second = await request(harness.app)
      .post(path)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    expect(second.status).toBe(403);
    expect(second.body).toEqual(REFUSED_BODY);
  });

  it('refuses a DIFFERENT operator applying it', async () => {
    // ADR-003: the id is NOT a bearer credential. It must accompany the
    // live session of the operator the authorisation was issued for.
    const created = await authorise();
    await harness.seed('OP-002', 'T. Hossain', 'OPERATOR', '1234');

    const otherSignIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: 'OP-002', secret: '1234' });

    const res = await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .set('Authorization', `Bearer ${otherSignIn.body.token}`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED_BODY);
  });

  it('refuses an out-of-scope consume', async () => {
    const created = await authorise();

    const res = await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'TOLERANCE_OVERRIDE', subject: 'comp-1' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED_BODY);
  });

  it('refuses with NO session', async () => {
    const created = await authorise();

    const res = await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('rejects a MALFORMED consume body with 400', async () => {
    const created = await authorise();

    const res = await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'NOT_A_PRIVILEGED_ACTION', subject: 'comp-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('the authorisation records in the database', () => {
  it('stores the reason in clear text and the operator it was issued for', async () => {
    const created = await authorise();

    const row = harness.module.db
      .prepare(
        'SELECT reason, requested_operator_id, supervisor_id FROM supervisor_authorisations WHERE id = ?',
      )
      .get(created.body.authorisationId) as {
      reason: string;
      requested_operator_id: string;
      supervisor_id: string;
    };

    expect(row.reason).toBe('Approved per QC hold');
    expect(row.requested_operator_id).toBe(OPERATOR_ID);
    expect(row.supervisor_id).toBe(SUPERVISOR_ID);
  });

  it('records the consumption as a SEPARATE row, leaving the authorisation untouched', async () => {
    const created = await authorise();

    await request(harness.app)
      .post(`/api/identity/authorisations/${created.body.authorisationId}/consume`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ action: 'CONFIRM_COMPONENT', subject: 'comp-1' });

    const authorisationRow = harness.module.db
      .prepare('SELECT * FROM supervisor_authorisations WHERE id = ?')
      .get(created.body.authorisationId) as Record<string, unknown>;

    // No consumed_at flag on the authorisation — consumption is its own
    // append-only fact (ADR-006).
    expect(authorisationRow['consumed_at']).toBeUndefined();

    const consumptionRow = harness.module.db
      .prepare('SELECT * FROM authorisation_consumptions WHERE authorisation_id = ?')
      .get(created.body.authorisationId) as Record<string, unknown>;
    expect(consumptionRow['authorisation_id']).toBe(created.body.authorisationId);
    expect(consumptionRow['operator_id']).toBe(OPERATOR_ID);
  });

  it('stores NO secret, token or hash in the authorisation row', async () => {
    const created = await authorise();

    const row = harness.module.db
      .prepare('SELECT * FROM supervisor_authorisations WHERE id = ?')
      .get(created.body.authorisationId) as Record<string, unknown>;

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(SUPERVISOR_SECRET);
    expect(serialised).not.toContain('$argon2');
    expect(serialised).not.toContain('token');
  });
});
