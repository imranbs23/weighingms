/**
 * The identity store — the unit tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STORE OWNS THE SESSION. AND IT HOLDS NO CREDENTIAL OF ITS OWN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The properties that matter:
 *
 * - a **refused sign-in is one failure** — it names no cause, so the
 *   screen is not an identity oracle;
 * - a **successful sign-in holds the token** — in memory, and nowhere else;
 * - **signing out ends the session** — even when the server could not be
 *   reached, because the operator asked to walk away;
 * - **the API's answer decides**, and the client never invents an
 *   identity.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdentityStore } from '../../src/007-weighingms-ui/state/identity-store.js';
import {
  getSessionToken,
  setSessionToken,
} from '../../src/007-weighingms-ui/api/session-token.js';

/** Stub `fetch` — and answer the identity endpoints. */
function stubApi(
  handler: (url: string, init?: RequestInit) => {
    status: number;
    body: unknown;
  },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const { status, body } = handler(String(input), init);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    }),
  );
}

describe('the identity store', () => {
  beforeEach(() => {
    setSessionToken(null);
    useIdentityStore.setState({
      state: { kind: 'UNKNOWN' },
      failure: null,
      busy: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionToken(null);
  });

  it('a successful sign-in holds the session — and the token', async () => {
    stubApi(() => ({
      status: 200,
      body: {
        token: 'the-opaque-token',
        sessionId: 'S-1',
        operator: {
          operatorId: 'OP-001',
          displayName: 'R. Karim',
          role: 'OPERATOR',
        },
        expiresAt: '2026-11-06T17:00:00.000Z',
      },
    }));

    const signedIn = await useIdentityStore
      .getState()
      .signIn('OP-001', '4821');

    expect(signedIn).toBe(true);
    const state = useIdentityStore.getState().state;
    expect(state.kind).toBe('SIGNED_IN');
    // And the identity is the API's.
    if (state.kind !== 'SIGNED_IN') throw new Error('expected SIGNED_IN');
    expect(state.operator.operatorId).toBe('OP-001');
    expect(state.operator.displayName).toBe('R. Karim');
    // And the token is held — in memory.
    expect(getSessionToken()).toBe('the-opaque-token');
  });

  it('a REFUSED sign-in is ONE failure — and it names no cause', async () => {
    stubApi(() => ({
      status: 401,
      body: { error: 'AUTHENTICATION_FAILED' },
    }));

    const signedIn = await useIdentityStore
      .getState()
      .signIn('OP-999', '0000');

    expect(signedIn).toBe(false);
    expect(useIdentityStore.getState().state.kind).not.toBe('SIGNED_IN');
    // The failure is a locale key — and the SAME one for every cause.
    expect(useIdentityStore.getState().failure).toBe('identity.signIn.refused');
    // And no token is held — a refused sign-in establishes nothing.
    expect(getSessionToken()).toBeNull();
  });

  it('an UNREACHABLE API is a REFUSAL — not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the network is down'))),
    );

    const signedIn = await useIdentityStore
      .getState()
      .signIn('OP-001', '4821');

    expect(signedIn).toBe(false);
    expect(useIdentityStore.getState().failure).toBe('identity.signIn.refused');
  });

  it('signing out ENDS the session — and drops the token', async () => {
    stubApi(() => ({
      status: 200,
      body: { token: 'the-opaque-token', operator: { operatorId: 'OP-001' } },
    }));
    await useIdentityStore.getState().signIn('OP-001', '4821');

    stubApi(() => ({ status: 200, body: { signedOut: true } }));
    await useIdentityStore.getState().signOut();

    expect(useIdentityStore.getState().state.kind).toBe('SIGNED_OUT');
    expect(getSessionToken()).toBeNull();
  });

  it('a sign-out that could NOT reach the server still ends the session', async () => {
    setSessionToken('the-opaque-token');
    useIdentityStore.setState({
      state: {
        kind: 'SIGNED_IN',
        operator: {
          operatorId: 'OP-001',
          displayName: 'R. Karim',
          role: 'OPERATOR',
        },
        sessionId: 'S-1',
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the network is down'))),
    );

    await useIdentityStore.getState().signOut();

    // The operator asked to walk away — so the terminal does not stay
    // authorised, whatever the server said.
    expect(useIdentityStore.getState().state.kind).toBe('SIGNED_OUT');
    expect(getSessionToken()).toBeNull();
  });

  it('the API decides who is signed in — and nobody is SIGNED_OUT', async () => {
    stubApi(() => ({
      status: 401,
      body: { error: 'UNAUTHENTICATED' },
    }));

    await useIdentityStore.getState().refresh();

    expect(useIdentityStore.getState().state.kind).toBe('SIGNED_OUT');
    // And the token is dropped — it is not a credential any more.
    expect(getSessionToken()).toBeNull();
  });

  it('a REFRESH that names an operator signs the terminal in', async () => {
    stubApi(() => ({
      status: 200,
      body: {
        sessionId: 'S-1',
        operator: {
          operatorId: 'SUP-001',
          displayName: 'S. Ahmed',
          role: 'SUPERVISOR',
        },
        expiresAt: '2026-11-06T17:00:00.000Z',
      },
    }));

    await useIdentityStore.getState().refresh();

    const state = useIdentityStore.getState().state;
    expect(state.kind).toBe('SIGNED_IN');
    if (state.kind !== 'SIGNED_IN') throw new Error('expected SIGNED_IN');
    expect(state.operator.role).toBe('SUPERVISOR');
  });
});
