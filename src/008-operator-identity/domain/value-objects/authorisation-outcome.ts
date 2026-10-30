/**
 * AuthorisationOutcome — the result of an authorisation operation.
 *
 * EXACTLY ONE of `authorisation` / `refusal` is set — the same one-or-the-
 * other shape bolt 001 used for `AuthenticationOutcome`.
 *
 * A REFUSAL IS A VALUE, NOT AN EXCEPTION
 * ---------------------------------------
 * Refusing a privileged action is this context's normal, expected output.
 * Modelling it as a thrown exception would push the refusal onto a generic
 * error handler, and a generic error handler would neither audit it nor
 * give it a reason. The story requires the refusal to be audited (A-8).
 *
 * The same shape carries the CONSUMED case, where the successful outcome
 * is a consumption record rather than an authorisation.
 */
import type { SupervisorAuthorisation } from '../entities/supervisor-authorisation.js';
import type { AuthorisationConsumption } from '../entities/authorisation-consumption.js';
import type { AuthorisationRefusal } from './authorisation-refusal.js';

export class AuthorisationOutcome {
  private constructor(
    private readonly authorisation: SupervisorAuthorisation | null,
    private readonly consumption: AuthorisationConsumption | null,
    private readonly refusal: AuthorisationRefusal | null,
  ) {}

  static granted(authorisation: SupervisorAuthorisation): AuthorisationOutcome {
    return new AuthorisationOutcome(authorisation, null, null);
  }

  static consumed(consumption: AuthorisationConsumption): AuthorisationOutcome {
    return new AuthorisationOutcome(null, consumption, null);
  }

  static refused(refusal: AuthorisationRefusal): AuthorisationOutcome {
    return new AuthorisationOutcome(null, null, refusal);
  }

  isGranted(): boolean {
    return this.authorisation !== null;
  }

  isConsumed(): boolean {
    return this.consumption !== null;
  }

  isRefused(): boolean {
    return this.refusal !== null;
  }

  /** The granted authorisation, or null. */
  getAuthorisation(): SupervisorAuthorisation | null {
    return this.authorisation;
  }

  /** The recorded consumption, or null. */
  getConsumption(): AuthorisationConsumption | null {
    return this.consumption;
  }

  /** The refusal, or null. */
  getRefusal(): AuthorisationRefusal | null {
    return this.refusal;
  }
}
