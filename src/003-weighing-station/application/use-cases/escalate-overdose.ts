/**
 * EscalateOverdose — raise the escalation.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTS ARE DERIVED. THE CLIENT SUPPLIES NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The surplus is the over-dose's — detected by the domain (bolt `015`) —
 * and the scope is built from the **session's own ids**. A client that
 * could assert the surplus could escalate a quantity that was never
 * over-dosed; a client that could assert the scope could present an
 * authorisation issued for something else (ADR-039).
 *
 * AND THE ESCALATION IS RAISED FOR EVERY OVER-DOSE
 * -------------------------------------------------
 * Bolt `016` raised it only for a **non-compensable** surplus, leaving a
 * compensable one to the proposal. The Step 24 decision (ADR-047) withdrew
 * the proposal from the operator, so the supervisor override is the one
 * recovery besides re-tare — and it must be available whenever the zone is
 * `OVER`.
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { Escalation } from '../../domain/entities/escalation.js';
import { AuthorisationScope } from '../../domain/value-objects/authorisation-scope.js';

export type EscalateOutcome =
  | {
      readonly kind: 'ESCALATED';
      readonly escalation: Escalation;
    }
  | {
      /** The zone is not `OVER` — nothing has been over-dosed. */
      readonly kind: 'NOT_OVER';
      readonly message: string;
    }
  | {
      /** There is no active component, or no reading. */
      readonly kind: 'NOT_AVAILABLE';
      readonly message: string;
    };

export interface EscalateOverdoseOptions {
  /** The session's identity — the scope's session half. */
  readonly sessionId: () => string;
  /** The active component — the scope's component half. */
  readonly activeComponentId: () => ComponentId | null;
  /**
   * The over-tolerance weight — the domain's, not the client's.
   *
   * It is `null` when the zone is not `OVER`, and the caller then does not
   * escalate. The escalation keeps it as the weight the supervisor
   * authorises; a heavier pour needs a new authorisation (ADR-047).
   */
  readonly surplusAmount: () => { readonly text: string; readonly unit: string } | null;
  /** The clock. */
  readonly clock: () => Date;
}

export class EscalateOverdose {
  constructor(private readonly options: EscalateOverdoseOptions) {}

  /**
   * Raise the escalation for the active component.
   */
  execute(): EscalateOutcome {
    const componentId = this.options.activeComponentId();
    if (componentId === null) {
      return { kind: 'NOT_AVAILABLE', message: 'No component is active' };
    }

    const surplus = this.options.surplusAmount();
    if (surplus === null) {
      // The zone is not `OVER`. The escalation is **not** the right
      // response — nothing has been over-dosed.
      return {
        kind: 'NOT_OVER',
        message: 'The zone is not OVER, so there is no over-dose',
      };
    }

    // THE SCOPE — derived from the session's own ids. Never supplied.
    const scope = AuthorisationScope.of(
      this.options.sessionId(),
      componentId.value,
    );

    const escalation = new Escalation(
      componentId.value,
      this.options.sessionId(),
      {
        text: surplus.text,
        unit: surplus.unit,
        toJSON: () => surplus.text,
      } as never,
      scope,
    );

    return { kind: 'ESCALATED', escalation };
  }
}
