/**
 * OverrideRecord — the recorded authorisation of a non-compensable
 * over-dose.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 09:41:07, supervisor OP-SUP-001 authorised component DYE-4471-Y of
 * session WS-1 in batch B-24187 with a surplus of 2.4000 g, for the reason
 * 'the client accepted the excess'"* is a fact about something that
 * physically happened. BRD DR-02 requires that it not be revised, and the
 * story requires it to be retained ≥ 5 years (BRD FR-24, DR-01).
 *
 * AND THE REASON IS IN CLEAR TEXT
 * -------------------------------
 * Unit `008`'s ADR-005 settled this for the authorisation's reason, and the
 * same reasoning applies here: *"it must be readable by an auditor five
 * years later — it is a record, not a credential."*
 *
 * So the reason is stored verbatim, and it is **not** hashed and **not**
 * truncated.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

export class OverrideRecord {
  constructor(
    /** The record's identity — a uuid. */
    readonly recordId: string,
    /** Unit `008`'s authorisation — the provenance. */
    readonly authorisationId: string,
    /** Who authorised it. */
    readonly supervisorId: string,
    /** The operator it was authorised **for**. */
    readonly operatorId: string,
    /** The reason — in **clear text** (ADR-005). */
    readonly reason: string,
    /** The component it covers. */
    readonly componentId: string,
    /** The session it covers. */
    readonly sessionId: string,
    /** The surplus it covers. */
    readonly surplusAmount: WeightValue,
    /** When it was authorised. */
    readonly authorisedAt: Instant,
  ) {}
}
