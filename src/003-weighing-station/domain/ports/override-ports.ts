/**
 * The ports of bolt 016 — the authorisation, and the override record.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE AUTHORISATION PORT IS OVER UNIT 008'S SERVICE — NOT A NEW MECHANISM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `008` already owns the entire privileged-action surface, and it
 * settled it in five ADRs — the fresh credential (ADR-001, ADR-003), the
 * uniform refusal (ADR-004), the clear-text reason (ADR-005), the
 * append-only consumption (ADR-006) and the single-use guarantee.
 *
 * **And unit `008` already named this exact action** — its
 * `PrivilegedAction` carries `CONFIRM_COMPONENT` for this story.
 *
 * So this port declares the **two operations** this bolt needs, and unit
 * `008`'s `AuthorisationService` satisfies it **structurally** — the
 * composition root binds the service directly, with no adapter class and
 * **no second implementation of any check** (ADR-039).
 *
 * WHY THAT MATTERS SO MUCH
 * ------------------------
 * A "reasonable" re-implementation of the checks in this bolt would be
 * correct in every branch — and a **compliance regression**. It would have
 * a different refusal vocabulary, a different expiry boundary, **no**
 * `UNIQUE` constraint against a double-spend, **no** audit event, and
 * **no** fresh constant-work credential verification. And every test in this
 * bolt would still pass.
 *
 * So the rule is absolute: **this bolt calls `consume` and re-checks
 * nothing.**
 */
import type {
  AuthorisationRequest,
} from '../../../008-operator-identity/domain/services/authorisation-service.js';
import type { AuthorisationOutcome } from '../../../008-operator-identity/domain/value-objects/authorisation-outcome.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { PrivilegedAction } from '../../../008-operator-identity/domain/value-objects/privileged-action.js';
import type { AuthorisationSubject } from '../../../008-operator-identity/domain/value-objects/authorisation-subject.js';
import type { OverrideRecord } from '../entities/override-record.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export interface OverrideAuthorisationPort {
  /**
   * The supervisor authenticates **freshly**, at the point of the action,
   * and an authorisation is created.
   */
  authorise(request: AuthorisationRequest): Promise<AuthorisationOutcome>;

  /**
   * Apply the authorisation to the action, **spending** it.
   *
   * The whole check set — scope, expiry, single-use, and the operator
   * being the one it was issued for — lives behind this call, and nothing
   * here re-checks any of it (ADR-039).
   */
  consume(
    authorisationId: string,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
    requestingOperatorId: OperatorId | null,
  ): Promise<AuthorisationOutcome>;
}

/**
 * OverrideRecordRepository — the durable record of an authorised exception.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The record describes something that physically happened, and BRD DR-02
 * forbids revising it. The repository has no update path, and the database's
 * triggers are the second line of the same guarantee (ADR-034).
 */
export interface OverrideRecordRepository {
  /** Record an authorised exception. INSERT ONLY. */
  save(record: OverrideRecord): Promise<void>;

  /**
   * The newest record for a component — the effective one.
   *
   * `null` when no override has been recorded. An un-overridden component is
   * a **state**, not an error.
   */
  latestFor(componentId: ComponentId): Promise<OverrideRecord | null>;
}
