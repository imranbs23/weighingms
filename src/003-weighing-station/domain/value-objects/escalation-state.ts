/**
 * EscalationState — where an over-dose's escalation is.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FOUR STATES, EACH NAMING A DIFFERENT NEXT STEP.
 * ══════════════════════════════════════════════════════════════════════
 *
 * | State | Meaning | The operator's next step |
 * |---|---|---|
 * | `ESCALATED` | Awaiting a supervisor | Authenticate, or wait |
 * | `AUTHORISED` | A supervisor authorised it | The weighing may be confirmed |
 * | `REFUSED` | A supervisor declined, or the authorisation was refused | The batch is held |
 * | `EXPIRED` | Nobody answered in time | A **fresh** authorisation |
 *
 * AND THE EXPIRY IS NOT A REFUSAL
 * ---------------------------------
 * They are **different facts** and they lead to **different next steps**:
 * a refused escalation is finished, and an expired one asks again. So
 * collapsing them would tell the operator that a supervisor declined when
 * in fact nobody answered.
 */
export type EscalationState =
  | 'ESCALATED'
  | 'AUTHORISED'
  | 'REFUSED'
  | 'EXPIRED';

export const ESCALATION_STATES: readonly EscalationState[] = [
  'ESCALATED',
  'AUTHORISED',
  'REFUSED',
  'EXPIRED',
];

/**
 * Is this an escalation state?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint.
 */
export function isEscalationState(value: unknown): value is EscalationState {
  return (
    typeof value === 'string' &&
    (ESCALATION_STATES as readonly string[]).includes(value)
  );
}
