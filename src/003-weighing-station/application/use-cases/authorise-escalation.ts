/**
 * AuthoriseEscalation — consume the authorisation, and record it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS BOLT RE-CHECKS NOTHING. THE SERVICE DOES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The order is:
 *
 * 1. **The escalation must exist and be pending.** A second authorisation
 *    attempt is refused — the escalation is decided **once**.
 * 2. **The authorisation is consumed.** Unit `008`'s `consume` runs the
 *    whole check set — scope, expiry, single-use, and the operator being
 *    the one it was issued for — and **spends** it atomically.
 * 3. **The `OverrideRecord` is written** — the supervisor, the reason in
 *    clear text, the time, the scope and the surplus it covers.
 * 4. **The escalation becomes `AUTHORISED`.**
 *
 * **And a refusal is UNIFORM** — the same body for every failure, because
 * a precise reason is a map of the defences (ADR-004). The reason is not
 * lost: unit `008` publishes `PrivilegeRefused` with it, and unit `006`
 * records the trail.
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { AuthorisationSubject } from '../../../008-operator-identity/domain/value-objects/authorisation-subject.js';
import { PrivilegedAction } from '../../../008-operator-identity/domain/value-objects/privileged-action.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Escalation } from '../../domain/entities/escalation.js';
import { OverrideRecord } from '../../domain/entities/override-record.js';
import type {
  OverrideAuthorisationPort,
  OverrideRecordRepository,
} from '../../domain/ports/override-ports.js';

export type AuthoriseEscalationOutcome =
  | {
      readonly kind: 'AUTHORISED';
      readonly escalation: Escalation;
      readonly record: OverrideRecord;
    }
  | {
      /**
       * The authorisation was **refused**.
       *
       * The reason is deliberately **absent** — ADR-004. The operator is
       * told the request was refused, and the audit trail carries why.
       */
      readonly kind: 'REFUSED';
      readonly message: string;
    }
  | {
      /** There is no escalation for this component. */
      readonly kind: 'NOT_FOUND';
      readonly message: string;
    }
  | {
      /** The escalation has already been decided. */
      readonly kind: 'ALREADY_DECIDED';
      readonly message: string;
    };

export interface AuthoriseEscalationOptions {
  /** The escalation being decided. */
  readonly escalation: () => Escalation | null;
  /** Unit `008`'s authorisation service. */
  readonly authorisations: OverrideAuthorisationPort;
  /** Where the override record is written. */
  readonly overrides: OverrideRecordRepository;
  /** The operator the action is for — from the session. */
  readonly operatorId: () => OperatorId | null;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class AuthoriseEscalation {
  constructor(private readonly options: AuthoriseEscalationOptions) {}

  /**
   * The supervisor authorises the escalation.
   *
   * @param authorisationId Unit `008`'s authorisation id.
   * @param supervisorId Who authorised it.
   * @param reason The reason — in clear text (ADR-005).
   */
  async execute(
    authorisationId: string,
    supervisorId: string,
    reason: string,
  ): Promise<AuthoriseEscalationOutcome> {
    const escalation = this.options.escalation();
    if (escalation === null) {
      this.options.onError?.('[escalation] there is no escalation to authorise');
      return {
        kind: 'NOT_FOUND',
        message: 'There is no escalation for this component',
      };
    }

    // DECIDED ONCE. A second attempt is refused — the escalation is not a
    // thing to be re-decided.
    if (!escalation.isPending) {
      this.options.onError?.(
        `[escalation] the escalation for component ${escalation.componentId} has already been decided`,
      );
      return {
        kind: 'ALREADY_DECIDED',
        message: 'This escalation has already been decided',
      };
    }

    // THE SUBJECT — derived from the session's own ids, so the scope is
    // correct by construction (ADR-039).
    const subject = AuthorisationSubject.create(escalation.scope.toSubject());

    // THE CONSUMPTION. Unit `008` runs every check and spends the
    // authorisation atomically. Nothing here re-checks anything.
    const outcome = await this.options.authorisations.consume(
      authorisationId,
      PrivilegedAction.of('CONFIRM_COMPONENT'),
      subject,
      this.options.operatorId(),
    );

    if (outcome.isRefused()) {
      // UNIFORM. The reason goes to the audit trail, not to the wire
      // (ADR-004).
      this.options.onError?.(
        '[escalation] the authorisation was refused for the over-dose',
      );
      escalation.refuse();
      return {
        kind: 'REFUSED',
        message: 'The authorisation was refused',
      };
    }

    // THE RECORD — the exception's own evidence.
    const record = new OverrideRecord(
      randomUUID(),
      authorisationId,
      supervisorId,
      this.options.operatorId()?.value ?? '',
      reason,
      escalation.componentId,
      escalation.sessionId,
      escalation.surplusAmount,
      Instant.of(this.options.clock()),
    );

    await this.options.overrides.save(record);

    escalation.authorise(authorisationId, supervisorId);

    return { kind: 'AUTHORISED', escalation, record };
  }
}
