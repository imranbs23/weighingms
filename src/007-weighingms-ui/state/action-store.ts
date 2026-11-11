/**
 * The action store — the action row's state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CONFIRM BUTTON IS ENABLED BY THE API'S ZONE — AND IT ALWAYS
 * STATES ITS REASON.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"the confirm action is enabled only when the reported zone is `OK`, and
 * it is disabled in every other zone with the **reason** for its
 * unavailability shown to the operator — the client computes no zone of its
 * own and takes the zone as received."*
 *
 * **And a disabled action ALWAYS states its reason:**
 *
 * *"never a silently dead control on a gloved terminal, which is a support
 * call rather than a design choice."*
 *
 * **So the state holds BOTH the flag and the reason** — and the reason is
 * never empty. A disabled action with no reason is the failure.
 *
 * AND THE CLIENT NEVER CONFIRMS OPTIMISTICALLY
 * ----------------------------------------------
 * *"The API is unreachable when the operator confirms → the action is
 * disabled with a stated reason; the client does not confirm optimistically
 * and does not show a success it cannot verify" (BRD FR-20).*
 */
import { create } from 'zustand';

/** The confirm action's state — the flag AND the reason. */
export interface ConfirmAction {
  /** Whether the action may be taken. */
  readonly enabled: boolean;
  /**
   * Why the action is unavailable — **never empty**.
   *
   * A locale key, so the reason is the bundle's text and not a literal.
   */
  readonly reason: string;
}

/** The reason keys — and each names a case the operator can act on. */
export const CONFIRM_REASON_OK = 'weigh.confirm.ok';
export const CONFIRM_REASON_SHORT = 'weigh.confirm.short';
export const CONFIRM_REASON_NEAR = 'weigh.confirm.near';
export const CONFIRM_REASON_OVER = 'weigh.confirm.over';
export const CONFIRM_REASON_UNDER = 'weigh.confirm.under';
export const CONFIRM_REASON_DISCONNECTED = 'weigh.confirm.disconnected';
export const CONFIRM_REASON_CALIBRATION = 'weigh.confirm.calibration';
export const CONFIRM_REASON_OVERRIDE_REQUIRED = 'weigh.confirm.overrideRequired';
export const CONFIRM_REASON_UNREACHABLE = 'weigh.confirm.unreachable';
export const CONFIRM_REASON_NO_COMPONENT = 'weigh.confirm.noComponent';

/**
 * The confirm action for a reported zone.
 *
 * **And the reason is ALWAYS one** — the zone decides it, and the client
 * computes no zone.
 */
export function confirmActionFor(
  zone: string | null,
  extras: {
    readonly unreachable?: boolean;
    readonly noComponent?: boolean;
    readonly awaitingSupervisor?: boolean;
  } = {},
): ConfirmAction {
  if (extras.unreachable === true) {
    return { enabled: false, reason: CONFIRM_REASON_UNREACHABLE };
  }
  if (extras.noComponent === true) {
    return { enabled: false, reason: CONFIRM_REASON_NO_COMPONENT };
  }
  if (extras.awaitingSupervisor === true) {
    // The override is required — and the weighing is NOT confirmed.
    return { enabled: false, reason: CONFIRM_REASON_OVERRIDE_REQUIRED };
  }

  switch (zone) {
    case 'OK':
      return { enabled: true, reason: CONFIRM_REASON_OK };
    case 'NEAR':
      return { enabled: false, reason: CONFIRM_REASON_NEAR };
    case 'OVER':
      return { enabled: false, reason: CONFIRM_REASON_OVER };
    case 'UNDER':
      return { enabled: false, reason: CONFIRM_REASON_UNDER };
    default:
      // No zone at all — and the reason says so rather than the button
      // being silently dead.
      return { enabled: false, reason: CONFIRM_REASON_SHORT };
  }
}

export interface ActionStore {
  /** The confirm action's state. */
  readonly confirm: ConfirmAction;
  /** The proposal — when the API reports one. */
  readonly proposal: unknown | null;
  /** The escalation — when the API reports one. */
  readonly escalation: unknown | null;
  /** Whether a request is in flight. */
  readonly busy: boolean;
  /** The last failure's reason — a locale key. */
  readonly failure: string | null;
  /** Set the zone, and recompute the confirm action. */
  setZone: (
    zone: string | null,
    extras?: {
      readonly unreachable?: boolean;
      readonly noComponent?: boolean;
      readonly awaitingSupervisor?: boolean;
    },
  ) => void;
  /** Set the proposal. */
  setProposal: (proposal: unknown | null) => void;
  /** Set the escalation. */
  setEscalation: (escalation: unknown | null) => void;
  /** A request started. */
  begin: () => void;
  /** A request finished. */
  end: () => void;
  /** A request failed — with a reason key. */
  fail: (reason: string) => void;
}

export const useActionStore = create<ActionStore>((set) => ({
  // The DEFAULT is disabled with a reason — never enabled.
  confirm: { enabled: false, reason: CONFIRM_REASON_NO_COMPONENT },
  proposal: null,
  escalation: null,
  busy: false,
  failure: null,

  setZone: (zone, extras = {}) =>
    set({ confirm: confirmActionFor(zone, extras) }),

  setProposal: (proposal) => set({ proposal }),

  setEscalation: (escalation) => set({ escalation }),

  begin: () => set({ busy: true, failure: null }),

  end: () => set({ busy: false }),

  fail: (reason) => set({ busy: false, failure: reason }),
}));
