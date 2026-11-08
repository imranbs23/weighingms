/**
 * The API client's credential handling.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TOKEN TRAVELS ON EVERY REQUEST. AND A REFUSED ONE IS DROPPED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the executable record of the defect that made every
 * session-guarded endpoint answer `401 UNAUTHENTICATED` to the running
 * product: **the client sent no credential at all.**
 *
 * Three properties, and each is separately testable:
 *
 * 1. **The bearer token is attached** — and it is attached from the ONE
 *    place that holds it.
 * 2. **A `401 UNAUTHENTICATED` drops the token** — a credential the server
 *    will not honour is not a credential, and keeping it means every
 *    later request is refused the same way.
 * 3. **The session's loss is ANNOUNCED** — so the app can ask the operator
 *    to sign in again rather than showing a screen whose data has quietly
 *    stopped arriving.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { call } from '../../src/007-weighingms-ui/api/client.js';
import {
  announceSessionLost,
  getSessionToken,
  onSessionLost,
  setSessionToken,
} from '../../src/007-weighingms-ui/api/session-token.js';

/** Stub `fetch` — and record what was sent. */
function stubFetch(
  status: number,
  body: unknown,
): { headers: () => Record<string, string> } {
  const sent: Record<string, string> = {};

  vi.stubGlobal(
    'fetch',
    vi.fn((_input: string, init?: RequestInit) => {
      Object.assign(sent, init?.headers ?? {});
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    }),
  );

  return { headers: () => sent };
}

describe("the API client's credential", () => {
  beforeEach(() => {
    setSessionToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionToken(null);
  });

  it('is attached to EVERY request as a bearer token', async () => {
    setSessionToken('the-opaque-token');
    const fetchStub = stubFetch(200, { ok: true });

    await call('/api/batch-queue');

    expect(fetchStub.headers()['Authorization']).toBe(
      'Bearer the-opaque-token',
    );
  });

  it('is NOT attached when there is no session', async () => {
    const fetchStub = stubFetch(200, { ok: true });

    await call('/api/scales');

    // And no empty header — a request with `Authorization: Bearer ` is a
    // request that LOOKS authenticated and is not.
    expect(fetchStub.headers()['Authorization']).toBeUndefined();
  });

  it('a REFUSED session is DROPPED — and the loss is announced', async () => {
    setSessionToken('a-token-the-server-will-not-honour');
    stubFetch(401, { error: 'UNAUTHENTICATED' });

    const announced: number[] = [];
    const stop = onSessionLost(() => {
      announced.push(1);
    });

    const result = await call('/api/batch-queue');

    expect(result.kind).toBe('FAILED');
    // The token is gone — so the next request is not sent with a
    // credential the server has already refused.
    expect(getSessionToken()).toBeNull();
    // And the loss was announced.
    expect(announced).toHaveLength(1);
    stop();
  });

  it('an ANONYMOUS refusal is NOT the loss of a session', async () => {
    // Nobody was signed in, so there is no session to lose — and
    // announcing one would drop a token that was never there.
    stubFetch(401, { error: 'UNAUTHENTICATED' });

    const announced: number[] = [];
    const stop = onSessionLost(() => {
      announced.push(1);
    });

    await call('/api/batch-queue');

    expect(announced).toHaveLength(0);
    stop();
  });

  it('a REFUSAL that is not UNAUTHENTICATED does not drop the token', async () => {
    setSessionToken('a-good-token');
    stubFetch(403, { error: 'SUPERVISOR_REQUIRED' });

    await call('/api/report/tolerance');

    // The session is fine — the OPERATOR is not allowed to read this.
    // Dropping the token there would sign the operator out for asking a
    // question they were not allowed to ask.
    expect(getSessionToken()).toBe('a-good-token');
  });

  it('the token is held in MEMORY — never written to storage', () => {
    setSessionToken('the-opaque-token');

    expect(getSessionToken()).toBe('the-opaque-token');
    // The client's whole storage surface: nothing persists a credential.
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
    expect(globalThis.sessionStorage?.length ?? 0).toBe(0);
  });

  it('announcing the loss clears the token FIRST', () => {
    setSessionToken('the-opaque-token');

    announceSessionLost();

    expect(getSessionToken()).toBeNull();
  });
});
