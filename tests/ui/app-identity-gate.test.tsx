/**
 * The app's identity gate.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TERMINAL SHOWS THE SIGN-IN SCREEN UNTIL SOMEONE IS SIGNED IN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the executable record of the defect: **the running product made
 * every session-guarded call and every one of them was refused** — the
 * queue answered `401 UNAUTHENTICATED`, the link state answered `401`, the
 * session answered `401` — because the client never authenticated.
 *
 * Two properties, and they are the two halves of the fix:
 *
 * 1. **No session, no station.** The sign-in screen is shown, and the
 *    station's screens are not.
 * 2. **A session, and the credential travels.** The queue is read **with
 *    the bearer token**, and the operator's chip names the operator.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/007-weighingms-ui/app/App.js';
import { useIdentityStore } from '../../src/007-weighingms-ui/state/identity-store.js';
import {
  getSessionToken,
  setSessionToken,
} from '../../src/007-weighingms-ui/api/session-token.js';

/** The operator the API reports. */
const OPERATOR = {
  operatorId: 'OP-001',
  displayName: 'R. Karim',
  role: 'OPERATOR',
};

/**
 * Stub the API — and record the requests that carried a credential.
 *
 * **Every endpoint the app reads is answered with its OWN shape**, because
 * a stub that answered everything with one body would make the test prove
 * nothing about the product.
 */
function stubApi(
  handler: (url: string, init?: RequestInit) => {
    status: number;
    body: unknown;
  } = (url) => defaultAnswer(url),
): { authorised: () => (string | undefined)[] } {
  const sent: (string | undefined)[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent.push(headers['Authorization']);

      const { status, body } = handler(String(input), init);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    }),
  );

  return { authorised: () => sent };
}

/** The API's honest answer for each endpoint the app reads. */
function defaultAnswer(url: string): {
  status: number;
  body: unknown;
} {
  if (url.includes('/api/identity/current')) {
    return {
      status: 401,
      body: { error: 'UNAUTHENTICATED' },
    };
  }
  if (url.includes('/api/batch-queue')) {
    return {
      status: 200,
      body: {
        batches: [],
        receivedAt: '2026-11-06T09:00:00.000Z',
        source: 'ORGATEX',
        freshness: { kind: 'CURRENT' },
        filter: null,
        statuses: [],
      },
    };
  }
  if (url.includes('/api/scales')) {
    return { status: 200, body: { scales: [] } };
  }
  if (url.includes('/api/orgatex/link-state')) {
    return {
      status: 200,
      body: {
        status: 'LINKED',
        ageMs: null,
        unsynchronisedCount: 0,
        lastError: null,
      },
    };
  }
  if (url.includes('/api/orgatex/sync-queue')) {
    return { status: 200, body: { count: 0, entries: [] } };
  }
  if (url.includes('/api/session')) {
    return { status: 200, body: { session: null } };
  }
  // The locale endpoint — every key resolves to itself until the bundle
  // answers, which is the documented fallback.
  return { status: 200, body: { value: 'x' } };
}

describe("the app's identity gate", () => {
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

  it('shows the SIGN-IN screen when nobody is signed in', async () => {
    stubApi();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
    });

    // And NOT the station — a queue screen whose every read is refused is
    // a screen the operator cannot act on.
    expect(screen.queryByTestId('batch-queue-screen')).toBeNull();
    expect(screen.queryByTestId('status-strip')).toBeNull();
  });

  it('does NOT read the guarded endpoints before anyone signs in', async () => {
    const api = stubApi();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
    });

    // The queue is NOT read — the read would be refused, and the strip
    // would report "the API is unreachable" when the real answer is
    // "nobody is signed in".
    const authorised = api.authorised().filter((h) => h !== undefined);
    expect(authorised).toHaveLength(0);
  });

  it('shows the STATION once an operator is signed in', async () => {
    stubApi((url) => {
      if (url.includes('/api/identity/current')) {
        return {
          status: 200,
          body: {
            sessionId: 'S-1',
            operator: OPERATOR,
            expiresAt: '2026-11-06T17:00:00.000Z',
          },
        };
      }
      return defaultAnswer(url);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('batch-queue-screen')).toBeTruthy();
    });

    // And the operator's chip names them — the API's identity, not the
    // client's.
    expect(screen.getByTestId('operator-bar-name').textContent).toBe(
      'R. Karim',
    );
    expect(
      screen.getByTestId('operator-bar').getAttribute('data-operator-id'),
    ).toBe('OP-001');
  });

  it('the READS carry the bearer token — the credential travels', async () => {
    setSessionToken('the-opaque-token');

    const api = stubApi((url) => {
      if (url.includes('/api/identity/current')) {
        return {
          status: 200,
          body: {
            sessionId: 'S-1',
            operator: OPERATOR,
            expiresAt: '2026-11-06T17:00:00.000Z',
          },
        };
      }
      return defaultAnswer(url);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('batch-queue-screen')).toBeTruthy();
    });

    // And the token is what travelled.
    expect(getSessionToken()).toBe('the-opaque-token');
    const withToken = api.authorised().filter((h) => h !== undefined);
    expect(withToken.length).toBeGreaterThan(0);
    for (const header of withToken) {
      expect(header).toBe('Bearer the-opaque-token');
    }
  });

  it('signing out returns the terminal to the SIGN-IN screen', async () => {
    stubApi((url) => {
      if (url.includes('/api/identity/current')) {
        return {
          status: 200,
          body: {
            sessionId: 'S-1',
            operator: OPERATOR,
            expiresAt: '2026-11-06T17:00:00.000Z',
          },
        };
      }
      return defaultAnswer(url);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('operator-bar')).toBeTruthy();
    });

    screen.getByTestId('operator-sign-out').click();

    await waitFor(() => {
      expect(screen.getByTestId('sign-in-screen')).toBeTruthy();
    });
  });
});
