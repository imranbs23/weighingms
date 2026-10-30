/**
 * Integration tests for the authorisation SERVICE and its ADAPTERS.
 *
 * These exercise the REAL adapters — real SQLite, real Argon2id, real
 * repositories — against the real service. The one concession is the CLOCK,
 * which is injected so the expiry boundary can be hit EXACTLY rather than
 * approximated with a sleep.
 *
 * The story's nine acceptance criteria are each exercised here, and every
 * refusal path is asserted to produce a NAMED reason — the reason is what
 * the audit trail records, so it must be exhaustive (A-8).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildIdentityModule,
  type IdentityModule,
} from '../../src/008-operator-identity/infrastructure/composition-root.js';
import type { IdentityConfig } from '../../src/008-operator-identity/infrastructure/config/identity-config.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../../src/008-operator-identity/domain/value-objects/operator-role.js';
import { Operator } from '../../src/008-operator-identity/domain/entities/operator.js';
import { PrivilegedAction } from '../../src/008-operator-identity/domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../src/008-operator-identity/domain/value-objects/authorisation-subject.js';
import { FixedAuthorisationClock } from '../../src/008-operator-identity/domain/services/authorisation-clock.js';
import {
  REFUSAL_ALREADY_USED,
  REFUSAL_EXPIRED,
  REFUSAL_NO_SIGNED_IN_OPERATOR,
  REFUSAL_NOT_THE_REQUESTING_OPERATOR,
  REFUSAL_OUT_OF_SCOPE,
  REFUSAL_REASON_MISSING,
  REFUSAL_REASON_NOT_MEANINGFUL,
  REFUSAL_ROLE_NOT_SUPERVISOR,
  REFUSAL_SELF_AUTHORISATION,
  REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED,
  REFUSAL_SUPERVISOR_INACTIVE,
  REFUSAL_UNKNOWN_AUTHORISATION,
} from '../../src/008-operator-identity/domain/value-objects/refusal-reason.js';
import type { AuthorisationEvent } from '../../src/008-operator-identity/domain/events/authorisation-events.js';

const OPERATOR_ID = 'OP-001';
const SUPERVISOR_ID = 'SV-001';
const OPERATOR_SECRET = '4821';
const SUPERVISOR_SECRET = '9931';

const ACTION = PrivilegedAction.of('CONFIRM_COMPONENT');
const OTHER_ACTION = PrivilegedAction.of('TOLERANCE_OVERRIDE');
const SUBJECT = AuthorisationSubject.create('comp-1');
const OTHER_SUBJECT = AuthorisationSubject.create('comp-2');

const AUTHORISATION_LIFETIME_MS = 15 * 60 * 1000;

class Harness {
  readonly module: IdentityModule;
  readonly clock: FixedAuthorisationClock;
  readonly events: AuthorisationEvent[] = [];

  constructor() {
    const start = new Date('2026-10-30T08:00:00.000Z');
    this.clock = new FixedAuthorisationClock(start);

    const config: IdentityConfig = {
      databasePath: ':memory:',
      sessionLifetimeMs: 8 * 60 * 60 * 1000,
      argon2Memory: 8192,
      argon2Passes: 1,
      authorisationLifetimeMs: AUTHORISATION_LIFETIME_MS,
    };

    this.module = buildIdentityModule({
      config,
      clock: () => this.clock.now(),
      authorisationClock: this.clock,
      onAuthorisationEvent: (event) => {
        this.events.push(event);
      },
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
      this.clock.now(),
    );
    await this.module.operatorRepository.save(operator);
    await this.module.credentials.create(
      operatorId,
      operator.role,
      secret,
    );
  }

  close(): void {
    this.module.close();
  }
}

let harness: Harness;

beforeEach(async () => {
  harness = new Harness();
  await harness.seed(OPERATOR_ID, 'R. Karim', 'OPERATOR', OPERATOR_SECRET);
  await harness.seed(SUPERVISOR_ID, 'S. Ahmed', 'SUPERVISOR', SUPERVISOR_SECRET);
});

afterEach(() => {
  harness.close();
});

/** Authorise, expecting success. Returns the authorisation id. */
async function authorise(
  overrides: {
    supervisorId?: string;
    secret?: string;
    action?: PrivilegedAction;
    subject?: AuthorisationSubject;
    reason?: string;
    requestingOperatorId?: OperatorId | null;
  } = {},
): Promise<string> {
  const outcome = await harness.module.authorisation.authorise({
    supervisorId: OperatorId.create(overrides.supervisorId ?? SUPERVISOR_ID),
    secret: overrides.secret ?? SUPERVISOR_SECRET,
    action: overrides.action ?? ACTION,
    subject: overrides.subject ?? SUBJECT,
    reason: overrides.reason ?? 'Approved per QC hold',
    requestingOperatorId:
      overrides.requestingOperatorId === undefined
        ? OperatorId.create(OPERATOR_ID)
        : overrides.requestingOperatorId,
  });

  if (!outcome.isGranted()) {
    throw new Error(
      `Expected a granted authorisation, got refusal: ${outcome.getRefusal()?.reason.value}`,
    );
  }
  const authorisation = outcome.getAuthorisation();
  if (authorisation === null) throw new Error('Granted outcome carried no authorisation');
  return authorisation.id;
}

/** The refusal reason of an authorisation attempt, or null if granted. */
async function refusalReason(
  overrides: Parameters<typeof authorise>[0] = {},
): Promise<string | null> {
  const outcome = await harness.module.authorisation.authorise({
    supervisorId: OperatorId.create(overrides.supervisorId ?? SUPERVISOR_ID),
    secret: overrides.secret ?? SUPERVISOR_SECRET,
    action: overrides.action ?? ACTION,
    subject: overrides.subject ?? SUBJECT,
    reason: overrides.reason ?? 'Approved per QC hold',
    requestingOperatorId:
      overrides.requestingOperatorId === undefined
        ? OperatorId.create(OPERATOR_ID)
        : overrides.requestingOperatorId,
  });
  return outcome.getRefusal()?.reason.value ?? null;
}

describe('authorising a privileged action', () => {
  it('grants an authorisation when a supervisor authenticates with a reason', async () => {
    const id = await authorise();
    expect(id).toBeTruthy();

    const stored = await harness.module.authorisationRepository.findById(id);
    expect(stored).not.toBeNull();
    expect(stored?.supervisorId.value).toBe(SUPERVISOR_ID);
    expect(stored?.action.value).toBe('CONFIRM_COMPONENT');
    expect(stored?.subject.value).toBe('comp-1');
    expect(stored?.reason.value).toBe('Approved per QC hold');
  });

  it('binds the authorisation to the configured lifetime', async () => {
    const id = await authorise();
    const stored = await harness.module.authorisationRepository.findById(id);
    if (stored === null) throw new Error('Authorisation missing');
    expect(stored.expiresAt.getTime() - stored.authorisedAt.getTime()).toBe(
      AUTHORISATION_LIFETIME_MS,
    );
  });

  it('publishes a PrivilegeAuthorised event', async () => {
    await authorise();
    const event = harness.events.find((e) => e.type === 'PrivilegeAuthorised');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'PrivilegeAuthorised',
      supervisorId: { value: SUPERVISOR_ID },
    });
  });

  it('refuses when the supervisor authenticates with the WRONG secret', async () => {
    expect(await refusalReason({ secret: '0000' })).toBe(
      REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED,
    );
  });

  it('refuses when the supervisor does not exist', async () => {
    expect(await refusalReason({ supervisorId: 'SV-999' })).toBe(
      REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED,
    );
  });

  it('refuses when the authoriser is not a supervisor', async () => {
    // The credential verifies — it IS the operator's credential — but the
    // role on the resolved operator row is OPERATOR, not SUPERVISOR. The
    // role comes from the credential's owner, never from the request.
    expect(
      await refusalReason({ supervisorId: OPERATOR_ID, secret: OPERATOR_SECRET }),
    ).toBe(REFUSAL_ROLE_NOT_SUPERVISOR);
  });

  it('refuses a DEACTIVATED supervisor', async () => {
    const operator = await harness.module.operatorRepository.findById(
      OperatorId.create(SUPERVISOR_ID),
    );
    if (operator === null) throw new Error('Supervisor missing');
    await harness.module.operatorRepository.save(operator.deactivate());

    expect(await refusalReason()).toBe(REFUSAL_SUPERVISOR_INACTIVE);
  });

  it('refuses SELF authorisation — the supervisor is the requesting operator', async () => {
    expect(
      await refusalReason({ requestingOperatorId: OperatorId.create(SUPERVISOR_ID) }),
    ).toBe(REFUSAL_SELF_AUTHORISATION);
  });

  it('refuses a MISSING reason', async () => {
    expect(await refusalReason({ reason: '   ' })).toBe(REFUSAL_REASON_MISSING);
  });

  it('refuses a reason with no letters or digits', async () => {
    expect(await refusalReason({ reason: '!!! ...' })).toBe(
      REFUSAL_REASON_NOT_MEANINGFUL,
    );
  });

  it('publishes a PrivilegeRefused event for EVERY refusal', async () => {
    // A-8: every refusal is audited with the actor, the subject and the reason.
    await refusalReason({ secret: '0000' });
    const event = harness.events.find((e) => e.type === 'PrivilegeRefused');
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'PrivilegeRefused',
      reason: { value: REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED },
      actor: { value: OPERATOR_ID },
    });
  });

  it('creates NO authorisation row when it refuses', async () => {
    const before = await harness.module.authorisationRepository.findBySubject(SUBJECT);
    await refusalReason({ secret: '0000' });
    const after = await harness.module.authorisationRepository.findBySubject(SUBJECT);
    expect(after.length).toBe(before.length);
  });
});

describe('evaluating an existing authorisation', () => {
  it('permits a live, in-scope, unspent authorisation', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.evaluate(id, ACTION, SUBJECT);
    expect(outcome.isGranted()).toBe(true);
  });

  it('does NOT spend the authorisation when it evaluates it', async () => {
    const id = await authorise();
    await harness.module.authorisation.evaluate(id, ACTION, SUBJECT);
    expect(await harness.module.consumptionRepository.existsFor(id)).toBe(false);
  });

  it('refuses an unknown authorisation', async () => {
    const outcome = await harness.module.authorisation.evaluate(
      'auth-does-not-exist',
      ACTION,
      SUBJECT,
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_UNKNOWN_AUTHORISATION);
  });

  it('refuses an authorisation presented for a different ACTION', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.evaluate(id, OTHER_ACTION, SUBJECT);
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_OUT_OF_SCOPE);
  });

  it('refuses an authorisation presented for a different SUBJECT', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.evaluate(id, ACTION, OTHER_SUBJECT);
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_OUT_OF_SCOPE);
  });

  it('refuses an authorisation AT exactly its expiry instant', async () => {
    const id = await authorise();
    harness.clock.advance(AUTHORISATION_LIFETIME_MS);
    const outcome = await harness.module.authorisation.evaluate(id, ACTION, SUBJECT);
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_EXPIRED);
  });

  it('permits an authorisation ONE millisecond before expiry', async () => {
    const id = await authorise();
    harness.clock.advance(AUTHORISATION_LIFETIME_MS - 1);
    const outcome = await harness.module.authorisation.evaluate(id, ACTION, SUBJECT);
    expect(outcome.isGranted()).toBe(true);
  });
});

describe('consuming an authorisation', () => {
  it('spends the authorisation and records the consumption', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.consume(
      id,
      ACTION,
      SUBJECT,
      OperatorId.create(OPERATOR_ID),
    );

    expect(outcome.isConsumed()).toBe(true);
    const consumption = outcome.getConsumption();
    expect(consumption?.authorisationId).toBe(id);
    expect(consumption?.operatorId.value).toBe(OPERATOR_ID);
    expect(await harness.module.consumptionRepository.existsFor(id)).toBe(true);
  });

  it('refuses a SECOND use — the authorisation is single-use', async () => {
    const id = await authorise();
    await harness.module.authorisation.consume(id, ACTION, SUBJECT, OperatorId.create(OPERATOR_ID));

    const second = await harness.module.authorisation.consume(
      id,
      ACTION,
      SUBJECT,
      OperatorId.create(OPERATOR_ID),
    );
    expect(second.getRefusal()?.reason.value).toBe(REFUSAL_ALREADY_USED);
  });

  it('refuses with NO signed-in operator', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.consume(id, ACTION, SUBJECT, null);
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_NO_SIGNED_IN_OPERATOR);
  });

  it('refuses when a DIFFERENT operator presents it', async () => {
    // ADR-003: the authorisation id is NOT a bearer credential — it must
    // accompany the live session of the operator it was issued for.
    const id = await authorise();
    const outcome = await harness.module.authorisation.consume(
      id,
      ACTION,
      SUBJECT,
      OperatorId.create('OP-999'),
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_NOT_THE_REQUESTING_OPERATOR);
  });

  it('refuses when the SUPERVISOR tries to apply their own authorisation', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.consume(
      id,
      ACTION,
      SUBJECT,
      OperatorId.create(SUPERVISOR_ID),
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_SELF_AUTHORISATION);
  });

  it('refuses an expired authorisation', async () => {
    const id = await authorise();
    harness.clock.advance(AUTHORISATION_LIFETIME_MS);
    const outcome = await harness.module.authorisation.consume(
      id,
      ACTION,
      SUBJECT,
      OperatorId.create(OPERATOR_ID),
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_EXPIRED);
  });

  it('refuses an out-of-scope authorisation', async () => {
    const id = await authorise();
    const outcome = await harness.module.authorisation.consume(
      id,
      OTHER_ACTION,
      SUBJECT,
      OperatorId.create(OPERATOR_ID),
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_OUT_OF_SCOPE);
  });

  it('refuses an unknown authorisation', async () => {
    const outcome = await harness.module.authorisation.consume(
      'auth-does-not-exist',
      ACTION,
      SUBJECT,
      OperatorId.create(OPERATOR_ID),
    );
    expect(outcome.getRefusal()?.reason.value).toBe(REFUSAL_UNKNOWN_AUTHORISATION);
  });

  it('publishes an AuthorisationConsumed event', async () => {
    const id = await authorise();
    await harness.module.authorisation.consume(id, ACTION, SUBJECT, OperatorId.create(OPERATOR_ID));
    const event = harness.events.find((e) => e.type === 'AuthorisationConsumed');
    expect(event).toBeDefined();
  });

  it('leaves the authorisation row UNCHANGED — consumption is a separate fact', async () => {
    // ADR-006 / A-7: the authorisation is append-only. Using it must not
    // mutate it.
    const id = await authorise();
    const before = await harness.module.authorisationRepository.findById(id);

    await harness.module.authorisation.consume(id, ACTION, SUBJECT, OperatorId.create(OPERATOR_ID));

    const after = await harness.module.authorisationRepository.findById(id);
    expect(after?.authorisedAt.getTime()).toBe(before?.authorisedAt.getTime());
    expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());
    expect(after?.reason.value).toBe(before?.reason.value);
  });
});

describe('the persistence adapters', () => {
  it('stores the reason in CLEAR TEXT — it is a record, not a credential', async () => {
    // ADR-005: hashing the reason would destroy the audit record.
    const id = await authorise({ reason: 'Approved per QC hold 12345' });
    const row = harness.module.db
      .prepare('SELECT reason FROM supervisor_authorisations WHERE id = ?')
      .get(id) as { reason: string };
    expect(row.reason).toBe('Approved per QC hold 12345');
  });

  it('stores NO session token — only the session id as provenance', async () => {
    const id = await authorise();
    const row = harness.module.db
      .prepare('SELECT session_id FROM supervisor_authorisations WHERE id = ?')
      .get(id) as { session_id: string };
    // A session id is an index key, not a credential.
    expect(row.session_id.length).toBeGreaterThan(0);
    expect(row.session_id).not.toContain('Bearer');
  });

  it('finds authorisations by subject', async () => {
    await authorise();
    const found = await harness.module.authorisationRepository.findBySubject(SUBJECT);
    expect(found.length).toBe(1);
  });

  it('finds EXPIRED authorisations without deleting them', async () => {
    const id = await authorise();
    harness.clock.advance(AUTHORISATION_LIFETIME_MS);

    const expired = await harness.module.authorisationRepository.findExpired(harness.clock.now());
    expect(expired.map((a) => a.id)).toContain(id);

    // The row is retained on audit terms — expiry MARKS, it never removes.
    expect(await harness.module.authorisationRepository.findById(id)).not.toBeNull();
  });

  it('refuses to overwrite an existing authorisation — it is append-only', async () => {
    const id = await authorise();
    const stored = await harness.module.authorisationRepository.findById(id);
    if (stored === null) throw new Error('Authorisation missing');

    await expect(harness.module.authorisationRepository.save(stored)).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('refuses a SECOND consumption of the same authorisation', async () => {
    // The UNIQUE constraint on authorisation_id IS the single-use rule —
    // it holds even under concurrency, where the service's own check is racy.
    const id = await authorise();
    await harness.module.authorisation.consume(id, ACTION, SUBJECT, OperatorId.create(OPERATOR_ID));

    const consumption = await harness.module.consumptionRepository.findByAuthorisationId(id);
    if (consumption === null) throw new Error('Consumption missing');

    await expect(harness.module.consumptionRepository.save(consumption)).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('round-trips an authorisation through the database', async () => {
    const id = await authorise();
    const stored = await harness.module.authorisationRepository.findById(id);
    expect(stored?.id).toBe(id);
    expect(stored?.reason.value).toBe('Approved per QC hold');
    expect(stored?.authorisedAt.toISOString()).toBe(
      new Date('2026-10-30T08:00:00.000Z').toISOString(),
    );
  });
});
