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
 * AND THE ESCALATION IS ONLY RAISED WHEN IT IS THE RIGHT ONE
 * -------------------------------------------------------
 * The surplus must be **not compensable** — a compensable surplus gets a
 * **proposal** (bolt `015`), and the operator accepts it there. Raising an
 * escalation for a compensable surplus would offer the supervisor a choice
 * that the proportional rule has already made.
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
      /** The surplus is compensable — the proposal path applies, not this one. */
      readonly kind: 'COMPENSABLE';
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
   * The over-dose's surplus — the domain's, not the client's.
   *
   * It is `null` when the zone is not `OVER` or the surplus is compensable,
   * and the caller then does not escalate.
   */
  readonly surplusAmount: () => { readonly text: string; readonly unit: string } | null;
  /**
   * Whether the surplus can be absorbed by the remaining components.
   *
   * **The escalation is for the NOT-compensable case.** A compensable
   * surplus gets a **proposal** (bolt `015`), and the operator accepts it
   * there — offering the supervisor a choice that the proportional rule has
   * already made would be offering the wrong question.
   */
  readonly isCompensable: () => boolean;
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
        kind: 'COMPENSABLE',
        message: 'The zone is not OVER, so there is no over-dose',
      };
    }

    // A COMPENSABLE surplus gets a proposal, not an escalation.
    if (this.options.isCompensable()) {
      return {
        kind: 'COMPENSABLE',
        message: 'The surplus is compensable, so a proposal applies',
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
