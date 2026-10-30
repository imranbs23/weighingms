/**
 * AuthorisationConsumption — the FACT that an authorisation was used.
 *
 * WHY THIS IS A SEPARATE AGGREGATE (ADR-006)
 * --------------------------------------------
 * The obvious implementation is a `consumed_at` column on the
 * authorisation. It is rejected: setting it MUTATES the authorisation, and
 * the authorisation is append-only (A-7, BRD DR-02). It would also make
 * the record's content depend on whether anyone had acted on it — a
 * reviewer comparing two copies of the database taken at different times
 * would see different rows and have no way to tell a legitimate correction
 * from a consumption.
 *
 * A boolean flag is worse: it cannot record WHEN, or BY WHOM, or AGAINST
 * WHAT.
 *
 * So consumption is its own append-only fact, and the single-use rule
 * becomes "an authorisation is spent if and only if a consumption exists
 * for it".
 *
 * WHY IT IS NOT A CHILD OF THE AUTHORISATION
 * -------------------------------------------
 * If it were owned by the authorisation — deleted with it, or constrained
 * to its lifetime — then removing the authorisation would remove the
 * evidence that it was used, and the audit trail's account of the exception
 * would become unverifiable. Two independent aggregates with independent
 * retention is what makes the record durable.
 *
 * THE SINGLE-USE RULE IS ENFORCED BY THE SCHEMA
 * ----------------------------------------------
 * `authorisation_consumptions.authorisation_id` carries a UNIQUE
 * constraint. The service ALSO performs an existence check before
 * inserting, but that check-then-insert sequence is RACY: two concurrent
 * consume requests can both observe "not spent". The constraint is the
 * guarantee; the check exists to produce a good error message.
 */
import type { OperatorId } from '../value-objects/operator-id.js';
import { PrivilegedAction } from '../value-objects/privileged-action.js';
import { AuthorisationSubject } from '../value-objects/authorisation-subject.js';

export class AuthorisationConsumption {
  constructor(
    readonly id: string,
    readonly authorisationId: string,
    readonly action: PrivilegedAction,
    readonly subject: AuthorisationSubject,
    readonly consumedAt: Date,
    readonly operatorId: OperatorId,
  ) {}
}
