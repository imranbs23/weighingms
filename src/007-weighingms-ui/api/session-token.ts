/**
 * The session token — and the ONE place that holds it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TOKEN IS HELD IN MEMORY. AND IT IS SENT ON EVERY REQUEST.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"an opaque session token held by the client and sent on every request"*
 * (unit 008's technical context).
 *
 * **And it is IN MEMORY** — the UI stores nothing: no `localStorage` copy
 * of a weighing, and no copy of the token either. A terminal that keeps a
 * credential on disk is a terminal whose credential outlives the shift,
 * and the unit's own rule is that the session expires on its own (FR-18,
 * NFR-12).
 *
 * WHY IT IS A MODULE AND NOT A STORE
 * ----------------------------------
 * The API client must attach the token to every call, and the API client is
 * BELOW the stores — so a Zustand store here would make the client depend
 * on React's render cycle, and would make the store depend on the client.
 * **This module is the leaf both sides can depend on.**
 *
 * AND A LOST SESSION IS ANNOUNCED
 * -------------------------------
 * The API answers a request whose session is gone with `401
 * UNAUTHENTICATED`. **That is the server saying "your session ended"**, and
 * the client must act on it — the token is dropped and the identity store
 * is told, so the operator is asked to sign in again rather than looking at
 * a screen whose data has quietly stopped arriving.
 */
let currentToken: string | null = null;

/** The listeners told when the session is lost. */
const listeners = new Set<() => void>();

/** Hold the session's token — or, with `null`, forget it. */
export function setSessionToken(token: string | null): void {
  currentToken = token;
}

/** The session's token — `null` when there is no session. */
export function getSessionToken(): string | null {
  return currentToken;
}

/**
 * Be told when the session is lost.
 *
 * @returns A function that stops the listening.
 */
export function onSessionLost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The session is gone — the API said so.
 *
 * **The token is dropped first**, so the next request is not sent with a
 * credential the server has already refused — and then the listeners are
 * told.
 */
export function announceSessionLost(): void {
  currentToken = null;
  for (const listener of [...listeners]) listener();
}
