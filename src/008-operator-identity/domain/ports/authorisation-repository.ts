/**
 * Authorisation repository ports.
 *
 * These contracts are declared by the DOMAIN and implemented by
 * infrastructure. Two properties are load-bearing:
 *
 * 1. `AuthorisationRepository` has NO `update` and NO `delete`. The
 *    authorisation is APPEND-ONLY (A-7, BRD DR-01/DR-02). The interface is
 *    the enforcement point: there is no method to call that would mutate an
 *    existing authorisation, so the prohibition is structural rather than a
 *    convention that a future developer could overlook.
 *
 * 2. `ConsumptionRepository` exists as a SEPARATE contract (ADR-006). The
 *    single-use rule is "a consumption exists for this authorisation", and
 *    the UNIQUE constraint on `authorisation_id` is the guarantee that makes
 *    it atomic under concurrency. The service's existence check exists only
 *    to produce a good error message.
 */
import type { SupervisorAuthorisation } from '../entities/supervisor-authorisation.js';
import type { AuthorisationConsumption } from '../entities/authorisation-consumption.js';
import type { AuthorisationSubject } from '../value-objects/authorisation-subject.js';

export interface AuthorisationRepository {
  /**
   * INSERT ONLY.
   *
   * There is no update and no delete counterpart — by design. Saving an
   * existing authorisation id must fail rather than overwrite it.
   */
  save(authorisation: SupervisorAuthorisation): Promise<void>;

  findById(id: string): Promise<SupervisorAuthorisation | null>;

  /** Authorisations issued against a subject — the lookup unit 003 makes. */
  findBySubject(subject: AuthorisationSubject): Promise<SupervisorAuthorisation[]>;

  /**
   * Authorisations whose expiry has passed.
   *
   * Used by the expiry marker. It does NOT delete anything — an expired
   * authorisation is retained on audit terms.
   */
  findExpired(now: Date): Promise<SupervisorAuthorisation[]>;
}

export interface ConsumptionRepository {
  /** INSERT ONLY — a consumption is a fact about what happened. */
  save(consumption: AuthorisationConsumption): Promise<void>;

  /** The consumption for an authorisation, or null. */
  findByAuthorisationId(authorisationId: string): Promise<AuthorisationConsumption | null>;

  /**
   * Has this authorisation been spent?
   *
   * The single-use check. The UNIQUE constraint on the column is the real
   * guarantee; this exists to give a good error message in the ordinary
   * case.
   */
  existsFor(authorisationId: string): Promise<boolean>;
}
