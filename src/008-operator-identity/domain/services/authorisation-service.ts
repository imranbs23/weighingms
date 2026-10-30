/**
 * AuthorisationService — THE SINGLE CHOKEPOINT.
 *
 * ══════════════════════════════════════════════════════════════════════
 * The unit brief requires that "the checks live behind ONE interface in
 * this unit, so they can be exhausted exhaustively by tests rather than
 * re-implemented at each call site". This is that interface.
 *
 * It has exactly three operations:
 *
 *   authorise(request)                     — the supervisor authenticates at
 *                                            the point of the action and an
 *                                            authorisation is created;
 *   evaluate(authorisationId, act, subj)   — a PURE CHECK against an
 *                                            existing authorisation;
 *   consume(authorisationId, act, subj)    — the same check, and on success
 *                                            the authorisation is SPENT.
 *
 * `evaluate` and `consume` share one implementation of the checks, so the
 * "is it allowed?" question and the "do it" question cannot drift apart.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STRUCTURAL EXPRESSION OF A-2 (FRESH AUTHENTICATION)
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is NO method anywhere that creates an authorisation from a session
 * id. The only path to a `SupervisorAuthorisation` runs through
 * `provider.verifyCredential` — a fresh credential verification performed
 * NOW.
 *
 * That is why "a supervisor holds a valid, unexpired session elsewhere" is
 * STRUCTURALLY IRRELEVANT rather than merely refused by a check someone
 * might forget to write. The supervisor's credential is verified against
 * the SUPERVISOR credential row at the moment of the action.
 *
 * The verification reuses bolt 001's `IdentityProvider` VERBATIM — the
 * same Argon2id profile (ADR-001) and the same constant-work guarantee. A
 * second credential-verification path would be a second place for the
 * timing defence to be wrong, and the supervisor endpoint is precisely
 * where a timing leak would become an identity oracle.
 */
import { SupervisorAuthorisation } from '../entities/supervisor-authorisation.js';
import { AuthorisationConsumption } from '../entities/authorisation-consumption.js';
import { OperatorId } from '../value-objects/operator-id.js';
import { SessionId } from '../value-objects/session-id.js';
import { PrivilegedAction } from '../value-objects/privileged-action.js';
import { AuthorisationSubject } from '../value-objects/authorisation-subject.js';
import { AuthorisationReason } from '../value-objects/authorisation-reason.js';
import { AuthorisationOutcome } from '../value-objects/authorisation-outcome.js';
import { AuthorisationRefusal } from '../value-objects/authorisation-refusal.js';
import { RefusalReason } from '../value-objects/refusal-reason.js';
import {
  REFUSAL_ALREADY_USED,
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
  RefusalReason as RefusalReasonValue,
} from '../value-objects/refusal-reason.js';
import type { IdentityProvider } from './identity-provider.js';
import type { AuthorisationPolicy } from './authorisation-policy.js';
import type { AuthorisationClock } from './authorisation-clock.js';
import type { AuthorisationWindowFactory } from './authorisation-window-factory.js';
import type {
  AuthorisationRepository,
  ConsumptionRepository,
} from '../ports/authorisation-repository.js';
import type { SessionRepository } from '../ports/repositories.js';
import {
  PrivilegeAuthorised,
  PrivilegeRefused,
  AuthorisationConsumed,
} from '../events/authorisation-events.js';

/** The request to authorise a privileged action. */
export interface AuthorisationRequest {
  /** The supervisor's identity, as presented. */
  readonly supervisorId: OperatorId;
  /** The supervisor's credential — verified fresh, at this moment. */
  readonly secret: string;
  readonly action: PrivilegedAction;
  readonly subject: AuthorisationSubject;
  /** The raw reason text. Validated by `AuthorisationReason`. */
  readonly reason: string;
  /**
   * The signed-in operator the action is FOR, or null when there is none.
   *
   * This is the operator at the terminal — the one the authorisation must
   * be DISTINCT from (A-1).
   */
  readonly requestingOperatorId: OperatorId | null;
}

export class AuthorisationService {
  constructor(
    private readonly provider: IdentityProvider,
    private readonly policy: AuthorisationPolicy,
    private readonly authorisations: AuthorisationRepository,
    private readonly consumptions: ConsumptionRepository,
    private readonly sessions: SessionRepository,
    private readonly clock: AuthorisationClock,
    private readonly windows: AuthorisationWindowFactory,
    private readonly generateId: () => string,
    private readonly generateSessionId: () => string,
  ) {}

  /**
   * Authorise a privileged action.
   *
   * THE ONLY PATH TO AN AUTHORISATION. It runs a FRESH credential
   * verification, and it does so BEFORE any of the other checks, so that
   * the credential work is performed on every request regardless of what
   * else is wrong — the constant-work property, inherited from bolt 001.
   */
  async authorise(request: AuthorisationRequest): Promise<AuthorisationOutcome> {
    const now = this.clock.now();

    // ── STEP 1: THE FRESH AUTHENTICATION ──
    // The supervisor's credential is verified against the SUPERVISOR role's
    // credential row. An operator's secret presented here simply fails the
    // hash comparison — credentials are never shared between roles (A-9).
    const verification = await this.provider.verifyCredential(
      request.supervisorId,
      request.secret,
    );

    if (!verification.isVerified()) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    const supervisor = verification.getOperator();
    if (supervisor === null) {
      // A provider contract violation. It must not become a
      // distinguishable outcome, so it takes the same refusal path.
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_SUPERVISOR_AUTHENTICATION_FAILED),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    if (!supervisor.isActive()) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_SUPERVISOR_INACTIVE),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    // ── STEP 2: THE SUPERVISOR ROLE ──
    // The role comes from the OPERATOR row the provider resolved from the
    // matched credential (invariant I-4). It is never read from the request.
    if (!supervisor.isSupervisor()) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_ROLE_NOT_SUPERVISOR),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    // ── STEP 3: A DIFFERENT PERSON (A-1) ──
    // Checked on IDENTITY, never on role. A person who holds both roles
    // still cannot self-authorise.
    if (
      request.requestingOperatorId !== null &&
      supervisor.id.equals(request.requestingOperatorId)
    ) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_SELF_AUTHORISATION),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    // ── STEP 4: THE REASON (A-3) ──
    // The reason is validated by constructing the value object. A
    // construction failure IS the refusal — the check is in the
    // constructor, so a call site cannot forget it.
    let reason: AuthorisationReason;
    try {
      reason = AuthorisationReason.create(request.reason);
    } catch {
      return this.refuse(
        RefusalReasonValue.of(
          request.reason.trim().length === 0
            ? REFUSAL_REASON_MISSING
            : REFUSAL_REASON_NOT_MEANINGFUL,
        ),
        request.requestingOperatorId,
        request.supervisorId,
        request.action,
        request.subject,
        now,
      );
    }

    // ── STEP 5: ESTABLISH THE SUPERVISOR'S SESSION ──
    // The fresh authentication produces a session, and the authorisation is
    // bound to it as PROVENANCE — it records how the supervisor proved
    // themselves, for the audit trail. It is not a capability: reading it
    // grants no access to the session.
    const sessionId = SessionId.create(this.generateSessionId());

    // ── STEP 6: CREATE THE AUTHORISATION ──
    const window = this.windows.create(now);
    const authorisation = new SupervisorAuthorisation(
      this.generateId(),
      sessionId,
      supervisor.id,
      request.requestingOperatorId,
      request.action,
      request.subject,
      reason,
      window,
    );

    await this.authorisations.save(authorisation);

    const event: PrivilegeAuthorised = new PrivilegeAuthorised(
      authorisation.id,
      authorisation.supervisorId,
      authorisation.requestedOperatorId,
      authorisation.sessionId.value,
      authorisation.action,
      authorisation.subject,
      authorisation.reason,
      authorisation.authorisedAt,
      authorisation.expiresAt,
      now,
    );
    this.publish(event);

    return AuthorisationOutcome.granted(authorisation);
  }

  /**
   * Would this authorisation permit this action, right now?
   *
   * A PURE CHECK — it does not spend the authorisation. Unit 003 uses this
   * to ask "may I do this?" before it commits to doing it.
   *
   * The check set is IDENTICAL to `consume`'s — that is the point of
   * sharing one implementation.
   */
  async evaluate(
    authorisationId: string,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
  ): Promise<AuthorisationOutcome> {
    const now = this.clock.now();

    const authorisation = await this.authorisations.findById(authorisationId);
    if (authorisation === null) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_UNKNOWN_AUTHORISATION),
        null,
        null,
        action,
        subject,
        now,
      );
    }

    const spent = await this.consumptions.existsFor(authorisationId);
    const reason = this.policy.evaluate(authorisation, action, subject, now, spent);

    if (reason !== null) {
      return this.refuse(reason, null, null, action, subject, now);
    }

    return AuthorisationOutcome.granted(authorisation);
  }

  /**
   * Apply the authorisation to a privileged action, SPENDING it.
   *
   * ADR-003: the authorisation id is NOT a bearer credential. The caller
   * must ALSO present the requesting operator's live session, and that
   * operator must be the one the authorisation was issued for. A leaked
   * authorisation id authorises nothing.
   */
  async consume(
    authorisationId: string,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
    requestingOperatorId: OperatorId | null,
  ): Promise<AuthorisationOutcome> {
    const now = this.clock.now();

    // ── The operator must be present ──
    // A privileged action is performed BY the operator. With no signed-in
    // operator there is nobody to apply it for, and the story says such an
    // attempt is "Refused and audited as a refusal".
    if (requestingOperatorId === null) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_NO_SIGNED_IN_OPERATOR),
        null,
        null,
        action,
        subject,
        now,
      );
    }

    const authorisation = await this.authorisations.findById(authorisationId);
    if (authorisation === null) {
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_UNKNOWN_AUTHORISATION),
        requestingOperatorId,
        null,
        action,
        subject,
        now,
      );
    }

    // ── The operator must be the one the authorisation was issued for ──
    // The authorisation is scoped to the operator's action. A different
    // operator presenting it is refused — this is what makes the id
    // useless on its own (ADR-003).
    //
    // TWO checks, in this order, because they are different facts:
    //
    //   1. The supervisor must not be the one applying it. The supervisor
    //      authored it and is now trying to apply their own exception.
    //   2. The applying operator must be the one it was issued FOR.
    //      Distinctness from the supervisor is NOT sufficient — an
    //      exception raised for operator A must not be applied by
    //      operator B.
    if (!authorisation.isDistinctFrom(requestingOperatorId)) {
      // The supervisor authored it and is now trying to apply it. That is
      // the self-authorisation case again, at the point of use.
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_SELF_AUTHORISATION),
        requestingOperatorId,
        null,
        action,
        subject,
        now,
      );
    }

    if (!authorisation.isIssuedFor(requestingOperatorId)) {
      // A different operator is trying to apply an exception raised for
      // somebody else. Refused — this is the check ADR-003 exists for.
      return this.refuse(
        RefusalReasonValue.of(REFUSAL_NOT_THE_REQUESTING_OPERATOR),
        requestingOperatorId,
        null,
        action,
        subject,
        now,
      );
    }

    // ── The shared check set: scope, expiry, then use ──
    const spent = await this.consumptions.existsFor(authorisationId);
    const reason = this.policy.evaluate(authorisation, action, subject, now, spent);

    if (reason !== null) {
      return this.refuse(reason, requestingOperatorId, null, action, subject, now);
    }

    // ── SPEND IT ──
    // The consumption is recorded as a SEPARATE append-only fact. The
    // authorisation itself is NOT updated (A-7, ADR-006).
    //
    // The UNIQUE constraint on `authorisation_consumptions.authorisation_id`
    // is the real guarantee against a double-spend. The existence check
    // above is racy under concurrency; this insert is not.
    const consumption = new AuthorisationConsumption(
      this.generateId(),
      authorisation.id,
      action,
      subject,
      now,
      requestingOperatorId,
    );

    try {
      await this.consumptions.save(consumption);
    } catch (error) {
      // The UNIQUE constraint rejected a concurrent double-spend. Report it
      // as the refusal it is.
      if (isUniqueConstraintViolation(error)) {
        return this.refuse(
          RefusalReasonValue.of(REFUSAL_ALREADY_USED),
          requestingOperatorId,
          null,
          action,
          subject,
          now,
        );
      }
      throw error;
    }

    const event: AuthorisationConsumed = new AuthorisationConsumed(
      consumption.authorisationId,
      consumption.action,
      consumption.subject,
      consumption.consumedAt,
      consumption.operatorId,
      now,
    );
    this.publish(event);

    return AuthorisationOutcome.consumed(consumption);
  }

  /**
   * Build a refusal and publish the audit event.
   *
   * EVERY refusal goes through here — there is no path that refuses
   * without emitting `PrivilegeRefused` (A-8). The event carries the
   * reason; the HTTP layer does not (ADR-004).
   */
  private refuse(
    reason: RefusalReason,
    actor: OperatorId | null,
    requestedBy: OperatorId | null,
    action: PrivilegedAction | null,
    subject: AuthorisationSubject | null,
    occurredAt: Date,
  ): AuthorisationOutcome {
    const event: PrivilegeRefused = new PrivilegeRefused(
      reason,
      actor,
      requestedBy,
      action,
      subject,
      occurredAt,
    );
    this.publish(event);

    const refusal = AuthorisationRefusal.create(reason, actor, action, subject, occurredAt);
    return AuthorisationOutcome.refused(refusal);
  }

  /**
   * Publish a domain event.
   *
   * The event bus is wired in Stage 4 by the composition root. It is a
   * NO-OP until then, which is correct: the events are PUBLISHED, not
   * stored, and unit 006 owns the trail that records them.
   */
  private publish(event: AuthorisationEvent): void {
    this.eventSink?.(event);
  }

  /** Set the sink that receives published events. */
  private eventSink?: (event: AuthorisationEvent) => void;

  /**
   * Attach the event sink.
   *
   * Called by the composition root. Kept as a setter rather than a
   * constructor argument so the service's construction signature stays
   * about its COLLABORATORS (the ports) and not about its observers.
   */
  onEvent(sink: (event: AuthorisationEvent) => void): void {
    this.eventSink = sink;
  }
}

/** The union of events this service publishes. */
export type AuthorisationEvent =
  | PrivilegeAuthorised
  | PrivilegeRefused
  | AuthorisationConsumed;

/**
 * Is this error a UNIQUE constraint violation?
 *
 * `node:sqlite` surfaces a constraint failure as an Error whose message
 * contains the constraint name. The check is deliberately narrow — a
 * different error must be re-thrown, not swallowed into a refusal, because
 * swallowing a real fault would hide a defect.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') ||
    error.message.includes('SQLITE_CONSTRAINT_UNIQUE')
  );
}
