/**
 * SessionState — where the session is in its machine.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SEVEN STATES, AND THE CLOSURE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The unit brief's machine, exactly:
 *
 * ```text
 *   AWAITING_BATCH ──▶ AWAITING_COMPONENT ──▶ WEIGHING
 *                                                 │
 *                          ┌──────────────────────┤
 *                          ▼                      ▼
 *                     CONFIRMING          COMPENSATING ──▶ ESCALATED
 *                          │
 *                          ▼
 *                      COMPLETE
 * ```
 *
 * Every state has a **defined meaning**, a **defined set of legal
 * actions**, and a **defined next transition**. That is what makes it a
 * state machine rather than a boolean soup, and it is why the set is
 * **closed** — a ninth state would be a state nobody has defined the
 * behaviour of.
 *
 * `COMPENSATING` and `ESCALATED` are in the set even though bolts `015`
 * and `016` build them: the machine is described **whole**, and the
 * transitions into them are reserved now so that no later bolt has to
 * widen the set.
 */
export type SessionState =
  | 'AWAITING_BATCH'
  | 'AWAITING_COMPONENT'
  | 'WEIGHING'
  | 'COMPENSATING'
  | 'ESCALATED'
  | 'CONFIRMING'
  | 'COMPLETE';

export const SESSION_STATES: readonly SessionState[] = [
  'AWAITING_BATCH',
  'AWAITING_COMPONENT',
  'WEIGHING',
  'COMPENSATING',
  'ESCALATED',
  'CONFIRMING',
  'COMPLETE',
];

/**
 * Is this a session state?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint, so
 * a value outside it cannot be written even by a path that bypasses the
 * domain. This guard is how a row is read **back** through the domain.
 */
export function isSessionState(value: unknown): value is SessionState {
  return (
    typeof value === 'string' &&
    (SESSION_STATES as readonly string[]).includes(value)
  );
}
