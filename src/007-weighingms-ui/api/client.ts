/**
 * The API client — the ONE place the SPA talks to the server.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT IS A RENDERER. IT HOLDS NO DATA AND NO RULES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every batch, recipe, component, weight and lot arrives over the API
 * (BRD IR-07, workbook Rule 5). And **every operator-facing string** comes
 * from the locale bundle (BRD FR-22, NFR-11).
 *
 * So this module holds **no data literals** — only the URL shapes and the
 * wire types. And a test reads this source and proves it.
 */
import {
  announceSessionLost,
  getSessionToken,
} from './session-token.js';

/** The base URL — the API's port, and nothing else. */
export const API_BASE_URL =
  (import.meta.env?.['VITE_API_BASE_URL'] as string | undefined) ??
  'http://localhost:3000';

/** The outcome of a call — and it distinguishes the three states. */
export type ApiResult<T> =
  | {
      /** The call succeeded. */
      readonly kind: 'OK';
      readonly status: number;
      readonly body: T;
    }
  | {
      /**
       * The call FAILED — and the server said why.
       *
       * **The body carries CODES, never a sentence** (BRD NFR-11, FR-22),
       * so the client renders a locale key for the code.
       */
      readonly kind: 'FAILED';
      readonly status: number;
      readonly error: string;
      /** The reason code, when the server gave one. */
      readonly reason?: string;
    }
  | {
      /**
       * The server could not be REACHED.
       *
       * **And that is a different fact from a refusal** — and the client
       * must show a different thing for it. A refusal is the server's
       * answer; an unreachable server is the absence of one.
       */
      readonly kind: 'UNREACHABLE';
      readonly message: string;
    };

/**
 * The one fetch wrapper.
 *
 * **And it never throws** — because a client that throws on a failed call
 * has to catch at every call site, and the one that forgets turns a
 * refused selection into a blank screen.
 */
export async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  // THE BEARER TOKEN. The session's credential travels on every request —
  // and it is the ONLY credential the client holds, and it is held in
  // memory only (unit 008's technical context).
  const token = getSessionToken();
  const authorization =
    token === null ? {} : { Authorization: `Bearer ${token}` };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authorization,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    // THE SERVER COULD NOT BE REACHED — and the client says so, rather
    // than rendering an empty-looking success (BRD FR-20).
    return {
      kind: 'UNREACHABLE',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A body that is not JSON is still a response — and the status code
    // is the answer.
    body = null;
  }

  if (!response.ok) {
    const errorBody = body as
      | { error?: string; reason?: string }
      | null;

    // THE SESSION IS GONE — and the API says so with a code, not a
    // sentence. The token is dropped and the identity store is told, so
    // the operator is asked to sign in again rather than watching a
    // screen whose data has quietly stopped arriving.
    //
    // **And it is announced only when a token WAS sent** — an anonymous
    // probe of a guarded endpoint is the client asking "is anybody there?",
    // and it is not the loss of a session.
    if (
      response.status === 401 &&
      errorBody?.error === 'UNAUTHENTICATED' &&
      token !== null
    ) {
      announceSessionLost();
    }

    return {
      kind: 'FAILED',
      status: response.status,
      error: errorBody?.error ?? 'UNKNOWN',
      ...(errorBody?.reason === undefined
        ? {}
        : { reason: errorBody.reason }),
    };
  }

  return { kind: 'OK', status: response.status, body: body as T };
}
