/**
 * The posting's state, and the attempt's outcome.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO CLOSER SETS, AND THE DIFFERENCE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `PostingState` has **three** members. `AttemptOutcome` has **four**.
 *
 * The extra member is `UNKNOWN` — and it is deliberately NOT in
 * `PostingState`. A lost response leaves the outcome genuinely unknown,
 * so the natural design is a fourth posting state. It is rejected.
 *
 * The reason: the posting's state is only ever advanced by a
 * **definitive** answer from the MES. An ambiguous outcome leaves the
 * posting `QUEUED` — not accepted, not rejected — and the **attempt**
 * records the ambiguity.
 *
 * That keeps the state machine to one edge:
 *
 *     QUEUED ──▶ ACCEPTED
 *            └─▶ REJECTED
 *
 * and puts `UNKNOWN` one level down, where it is a fact about a *try*
 * rather than a state the posting is left in. (ADR-024.)
 */

/**
 * The posting's state.
 *
 * `QUEUED` means pending. It is **never** reported as posted.
 */
export type PostingState = 'QUEUED' | 'ACCEPTED' | 'REJECTED';

export const POSTING_STATES: readonly PostingState[] = [
  'QUEUED',
  'ACCEPTED',
  'REJECTED',
];

export function isPostingState(value: unknown): value is PostingState {
  return (
    typeof value === 'string' &&
    (POSTING_STATES as readonly string[]).includes(value)
  );
}

/**
 * The outcome of **one attempt**.
 *
 * Wider than `PostingState` on purpose:
 *
 * - `UNKNOWN` — the MES may have received it; the response was lost.
 * - `UNREACHABLE` — the MES could not be contacted at all.
 *
 * Both leave the posting `QUEUED`. Neither is a posting state, because
 * neither is an answer from the MES.
 */
export type AttemptOutcome =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'UNREACHABLE';

export const ATTEMPT_OUTCOMES: readonly AttemptOutcome[] = [
  'ACCEPTED',
  'REJECTED',
  'UNKNOWN',
  'UNREACHABLE',
];

export function isAttemptOutcome(value: unknown): value is AttemptOutcome {
  return (
    typeof value === 'string' &&
    (ATTEMPT_OUTCOMES as readonly string[]).includes(value)
  );
}
