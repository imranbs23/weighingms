/**
 * The link state's domain events.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LINK'S OWN VOCABULARY IS ABOUT THE **STATE**.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is deliberately **no** `LinkContactFailed` event here. Bolt 006's
 * `*ReadFailed` and attempt events already cover the contact side — the
 * failure happened, and it was recorded there.
 *
 * What is missing is the *state* change, and that is the only thing this
 * bolt's vocabulary is about. A failed contact that leaves the link
 * `DEGRADED` is not a state change, and emitting an event for it would
 * make "the link changed" mean "something happened" — which is exactly
 * the ambiguity the `LinkTransition` record exists to remove.
 *
 * The event fires on a **change**, and carries the transition that
 * caused it.
 */
import type { LinkStatus } from '../value-objects/link-status.js';
import type { LinkTransitionCause } from '../entities/link-transition.js';

export interface LinkStateChanged {
  readonly type: 'LINK_STATE_CHANGED';
  readonly from: LinkStatus;
  readonly to: LinkStatus;
  readonly occurredAt: Date;
  readonly cause: LinkTransitionCause;
}

export type LinkEvent = LinkStateChanged;
