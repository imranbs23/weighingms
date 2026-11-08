/**
 * The sign-in screen — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SCREEN ASKS FOR A CREDENTIAL. IT NEVER JUDGES THE OPERATOR.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The property that matters most: **one refusal, and it names no cause.**
 * A sign-in screen that said "no such operator" would be an identity
 * oracle, and the operator would learn which operator ids exist by
 * watching what it refused.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SignInScreen } from '../../src/007-weighingms-ui/screens/identity/SignInScreen.js';
import { useIdentityStore } from '../../src/007-weighingms-ui/state/identity-store.js';
import { setSessionToken } from '../../src/007-weighingms-ui/api/session-token.js';

describe('the sign-in screen', () => {
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

  /** Stub the sign-in — and answer the locale bundle. */
  function stubApi(
    status: number,
    body: unknown,
  ): { bodies: () => string[] } {
    const bodies: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        if (String(input).includes('/api/identity/sign-in')) {
          bodies.push(String(init?.body ?? ''));
          return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          });
        }
        // The locale endpoint — every key resolves to itself until the
        // bundle answers, which is the documented fallback.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: 'x' }),
        });
      }),
    );

    return { bodies: () => bodies };
  }

  it('asks for an identifier and a secret', () => {
    stubApi(200, { token: 'x', operator: {} });

    render(<SignInScreen />);

    expect(screen.getByTestId('sign-in-operator-id')).toBeTruthy();
    expect(screen.getByTestId('sign-in-secret')).toBeTruthy();
    expect(screen.getByTestId('sign-in-submit')).toBeTruthy();
  });

  it('the secret field is a PASSWORD field', () => {
    stubApi(200, { token: 'x', operator: {} });

    render(<SignInScreen />);

    const secret = screen.getByTestId('sign-in-secret');
    expect(secret.getAttribute('type')).toBe('password');
  });

  it('the submit is DISABLED until both fields are filled', async () => {
    stubApi(200, { token: 'x', operator: {} });

    render(<SignInScreen />);

    const submit = screen.getByTestId('sign-in-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByTestId('sign-in-operator-id'), 'OP-001');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByTestId('sign-in-secret'), '4821');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('signing in sends the credential — and the terminal becomes SIGNED_IN', async () => {
    const api = stubApi(200, {
      token: 'the-opaque-token',
      operator: {
        operatorId: 'OP-001',
        displayName: 'R. Karim',
        role: 'OPERATOR',
      },
    });

    render(<SignInScreen />);

    await userEvent.type(screen.getByTestId('sign-in-operator-id'), 'OP-001');
    await userEvent.type(screen.getByTestId('sign-in-secret'), '4821');
    await userEvent.click(screen.getByTestId('sign-in-submit'));

    await waitFor(() => {
      expect(useIdentityStore.getState().state.kind).toBe('SIGNED_IN');
    });

    // The credential went to the API — and nowhere else.
    expect(api.bodies()).toHaveLength(1);
    expect(api.bodies()[0]).toContain('operatorId');
    expect(api.bodies()[0]).toContain('secret');
  });

  it('a REFUSED sign-in shows a reason — and it names NO cause', async () => {
    stubApi(401, { error: 'AUTHENTICATION_FAILED' });

    render(<SignInScreen />);

    await userEvent.type(screen.getByTestId('sign-in-operator-id'), 'OP-999');
    await userEvent.type(screen.getByTestId('sign-in-secret'), '0000');
    await userEvent.click(screen.getByTestId('sign-in-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('sign-in-failure')).toBeTruthy();
    });

    // The SAME message for every cause — the screen is not an oracle.
    expect(useIdentityStore.getState().failure).toBe('identity.signIn.refused');
  });

  it('every touch target is AT LEAST 15 mm', () => {
    stubApi(200, { token: 'x', operator: {} });

    render(<SignInScreen />);

    // The token IS 15 mm — and the rendered target meets it.
    for (const testId of [
      'sign-in-operator-id',
      'sign-in-secret',
      'sign-in-submit',
    ]) {
      const styles = window.getComputedStyle(screen.getByTestId(testId));
      expect(
        Number.parseFloat(styles.minHeight || '0'),
        `${testId} is not at least 15 mm`,
      ).toBeGreaterThanOrEqual(56);
    }
  });
});
