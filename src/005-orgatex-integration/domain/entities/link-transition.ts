/**
 * LinkTransition — an append-only record of ONE transition of the link
 * state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A RECORD, NOT A STATE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The link's *current* status is the `LinkState` value object. A
 * `LinkTransition` is what happened: the previous status, the new one,
 * when, and why.
 *
 * It is written whenever the status **changes** — and never for a status
 * that did not change. A failure that leaves the link `DEGRADED` updates
 * the failure count and the error, but records **no** transition, because
 * there was no transition.
 *
 * That distinction is the whole point. "The link changed" and "something
 * happened" are different claims, and conflating them makes the
 * transition log useless for the diagnosis it exists to serve.
 *
 * APPEND-ONLY
 * -----------
 * A history that could be rewritten is not a history. The repository has
 * no `update` and no `delete`, and the table carries triggers that abort
 * both.
 */
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkStatus } from '../value-objects/link-status.js';

/**
 * What caused a transition.
 *
 * A closed set, so a consumer branches on it:
 *
 * - `FIRST_OBSERVATION` — the station's first look at the link.
 * - `CONTACT_SUCCESS`   — a contact succeeded.
 * - `CONTACT_FAILURE`   — a contact failed.
 * - `FRESHNESS_DEADLINE`— the last successful snapshot aged out of its
 *   window with no contact in between (ADR-012).
 */
export type LinkTransitionCause =
  | 'FIRST_OBSERVATION'
  | 'CONTACT_SUCCESS'
  | 'CONTACT_FAILURE'
  | 'FRESHNESS_DEADLINE';

export const LINK_TRANSITION_CAUSES: readonly LinkTransitionCause[] = [
  'FIRST_OBSERVATION',
  'CONTACT_SUCCESS',
  'CONTACT_FAILURE',
  'FRESHNESS_DEADLINE',
];

export interface LinkTransition {
  readonly from: LinkStatus;
  readonly to: LinkStatus;
  readonly occurredAt: Instant;
  readonly cause: LinkTransitionCause;
}

/**
 * Build a transition.
 *
 * A transition from a status **to itself** is refused. It is not a
 * transition, and the story says such a contact records nothing — so the
 * type will not let one be written.
 */
export function linkTransition(params: {
  readonly from: LinkStatus;
  readonly to: LinkStatus;
  readonly occurredAt: Instant;
  readonly cause: LinkTransitionCause;
}): LinkTransition {
  if (params.from === params.to) {
    throw new Error(
      `A link transition must change the status — ${params.from} to ${params.to} is not a transition`,
    );
  }
  return {
    from: params.from,
    to: params.to,
    occurredAt: params.occurredAt,
    cause: params.cause,
  };
}
