/**
 * The identity store — who is at the terminal.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STORE OWNS THE SESSION. AND IT HOLDS NO CREDENTIAL OF ITS OWN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The token lives in `api/session-token.ts` — a module BELOW the stores,
 * because the API client needs it and the API client must not depend on
 * React. **The store decides WHEN a session exists; the module holds the
 * credential.**
 *
 * AND THE THREE STATES ARE DISTINGUISHABLE
 * ---------------------------------------
 *
 * - **SIGNED_OUT** — nobody has signed in;
 * - **SIGNED_IN** — an operator is signed in, and the identity is the
 *   API's;
 * - **UNKNOWN** — the client has not asked the API yet.
 *
 * **And the distinction is the point.** A client that rendered "whatever
 * is in `operator`" would show a signed-out terminal as though it were
 * signed in — and every session-guarded call would then be refused with a
 * `401` the operator sees as a broken screen rather than as "sign in".
 *
 * AND A REFUSED SIGN-IN IS NOT AN ERROR
 * ------------------------------------
 * *"The response is byte-for-byte identical to a wrong-password response"*
 * — so the store holds **one** failure, and it says nothing about which
 * cause it was.
 */
import { create } from 'zustand';
import {
  fetchCurrentOperator,
  signIn as signInEndpoint,
  signOut as signOutEndpoint,
  type OperatorReport,
} from '../api/endpoints.js';
import {
  announceSessionLost,
  onSessionLost,
  setSessionToken,
} from '../api/session-token.js';

/** The identity's state — and the three are DISTINCT. */
export type IdentityState =
  | { readonly kind: 'UNKNOWN' }
  | { readonly kind: 'SIGNED_OUT' }
  | {
      readonly kind: 'SIGNED_IN';
      readonly operator: OperatorReport;
      readonly sessionId: string | null;
    };

/** Why a sign-in was refused — and it names no cause. */
export const SIGN_IN_REFUSED = 'identity.signIn.refused';

export interface IdentityStore {
  readonly state: IdentityState;
  /** The last sign-in failure — a locale key, and never a cause. */
  readonly failure: string | null;
  /** Whether a sign-in is in flight. */
  readonly busy: boolean;
  /** Sign in with a credential. */
  signIn: (operatorId: string, secret: string) => Promise<boolean>;
  /** End the session. */
  signOut: () => Promise<void>;
  /** Ask the API who is signed in — and take its answer. */
  refresh: () => Promise<void>;
  /** Dismiss the last failure. */
  clearFailure: () => void;
}

export const useIdentityStore = create<IdentityStore>((set) => ({
  state: { kind: 'UNKNOWN' },
  failure: null,
  busy: false,

  signIn: async (operatorId, secret) => {
    set({ busy: true, failure: null });

    const result = await signInEndpoint(operatorId, secret);

    if (result.kind !== 'OK') {
      // ONE FAILURE. The API does not say which cause it was, and neither
      // does the client — a sign-in screen that said "no such operator"
      // would be an identity oracle.
      set({ busy: false, failure: SIGN_IN_REFUSED });
      return false;
    }

    // THE TOKEN IS HELD IN MEMORY ONLY — the UI stores nothing, and a
    // credential that outlives the shift on the terminal's disk is a
    // credential nobody signed out (FR-18, NFR-12).
    setSessionToken(result.body.token);

    set({
      busy: false,
      failure: null,
      state: {
        kind: 'SIGNED_IN',
        operator: result.body.operator,
        sessionId: null,
      },
    });
    return true;
  },

  signOut: async () => {
    // THE SERVER IS TOLD FIRST — and the local session is ended whether or
    // not the answer arrived. A sign-out that failed to reach the server
    // must still end the session at this terminal, because the operator
    // asked to walk away.
    await signOutEndpoint();
    setSessionToken(null);
    set({ state: { kind: 'SIGNED_OUT' }, failure: null });
  },

  refresh: async () => {
    const result = await fetchCurrentOperator();

    if (result.kind !== 'OK') {
      // The API could not be reached, or the session is gone. **The token
      // is dropped** — a token the server will not honour is not a
      // credential, and keeping it would mean every later request is
      // refused with the same `401`.
      setSessionToken(null);
      set({ state: { kind: 'SIGNED_OUT' } });
      return;
    }

    if (result.body.operator === null) {
      setSessionToken(null);
      set({ state: { kind: 'SIGNED_OUT' } });
      return;
    }

    // THE OPERATOR MUST BE AN OPERATOR. A response that does not carry
    // one is not an identity — and rendering a chip with no operator in it
    // would put the wrong person (or nobody) on every weighing the
    // terminal goes on to record.
    if (typeof result.body.operator !== 'object') {
      setSessionToken(null);
      set({ state: { kind: 'SIGNED_OUT' } });
      return;
    }

    set({
      state: {
        kind: 'SIGNED_IN',
        operator: result.body.operator,
        sessionId: result.body.sessionId,
      },
    });
  },

  clearFailure: () => set({ failure: null }),
}));

/**
 * The session was lost — the API said so.
 *
 * **And the store is told**, so the app returns to the sign-in screen
 * instead of looking at a screen whose data has quietly stopped arriving.
 */
onSessionLost(() => {
  useIdentityStore.setState({
    state: { kind: 'SIGNED_OUT' },
    failure: null,
  });
});

/** The operator's display name — or `null` when nobody is signed in. */
export function signedInOperator(state: IdentityState): OperatorReport | null {
  return state.kind === 'SIGNED_IN' ? state.operator : null;
}
