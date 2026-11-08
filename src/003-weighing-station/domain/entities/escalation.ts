/**
 * Escalation — an over-dose awaiting a supervisor's decision.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A STATE THE WORK IS IN — NOT A RECORD OF A COMPLETED ACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The session is the **live state** and it is mutable (ADR-036). The
 * escalation is part of that live state — the weighing is parked, waiting.
 * It is **not** an immutable record: the `OverrideRecord` is that, and it
 * is written when the escalation is decided.
 *
 * AND THE SCOPE AND THE SURPLUS ARE DERIVED, NEVER SUPPLIED
 * ---------------------------------------------------------
 * The scope is built from the **session's own ids** — the session the
 * operator is working in and the component it has active — and the surplus
 * is the one the over-dose **detected**. Neither comes from a request body,
 * so a client cannot escalate a quantity that was never over-dosed, nor
 * present an authorisation issued for something else (ADR-039).
 *
 * AND THE WEIGHING IS NOT CONFIRMED IN ANY STATE BUT `AUTHORISED`
 * ---------------------------------------------------------------
 * There is no other path to a `WeighingRecord` (invariant 3). The
 * confirmation gate accepts an `OVER` zone **only** when the escalation
 * is `AUTHORISED` — and the authorisation was **consumed** in the same call.
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { AuthorisationScope } from '../value-objects/authorisation-scope.js';
import type { EscalationState } from '../value-objects/escalation-state.js';

export class Escalation {
  private currentState: EscalationState = 'ESCALATED';

  constructor(
    /** The component that was over-dosed. */
    readonly componentId: string,
    /** The session the escalation belongs to. */
    readonly sessionId: string,
    /** The surplus the escalation covers — the over-dose's, not the client's. */
    readonly surplusAmount: WeightValue,
    /** The scope the authorisation is bound to — derived, never supplied. */
    readonly scope: AuthorisationScope,
  ) {}

  /** Where the escalation is. */
  get state(): EscalationState {
    return this.currentState;
  }

  /** Unit `008`'s authorisation id, once one has been consumed. */
  authorisationId: string | null = null;

  /** The supervisor who authorised it, once one has. */
  supervisorId: string | null = null;

  /**
   * Is the escalation still awaiting a decision?
   *
   * **And it can be decided ONCE** — a second authorisation attempt is
   * refused, so a decision cannot be taken twice.
   */
  get isPending(): boolean {
    return this.currentState === 'ESCALATED';
  }

  /**
   * The escalation was authorised.
   *
   * @throws When it was already decided — the escalation is decided once.
   */
  authorise(authorisationId: string, supervisorId: string): void {
    this.assertPending();
    this.currentState = 'AUTHORISED';
    this.authorisationId = authorisationId;
    this.supervisorId = supervisorId;
  }

  /**
   * The authorisation was refused, or a supervisor declined.
   *
   * The weighing is **not** confirmed and the batch is held.
   */
  refuse(): void {
    this.assertPending();
    this.currentState = 'REFUSED';
  }

  /**
   * Nobody answered in time.
   *
   * **Not a refusal** — a fresh authorisation is needed.
   */
  expire(): void {
    this.assertPending();
    this.currentState = 'EXPIRED';
  }

  private assertPending(): void {
    if (!this.isPending) {
      throw new Error(
        `The escalation for component ${this.componentId} has already been decided`,
      );
    }
  }
}
