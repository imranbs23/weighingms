/**
 * SessionTokenGenerator — produces high-entropy opaque session tokens.
 *
 * 32 bytes from `crypto.randomBytes`, base64url-encoded. 256 bits of
 * entropy: a token cannot be guessed, and it carries no structure, so it
 * reveals nothing about the operator (INVARIANT I-2).
 *
 * base64url (rather than base64) so the token is safe in an HTTP header
 * without escaping — `+`, `/` and `=` would otherwise need encoding in the
 * `Authorization` header.
 */
import { randomBytes } from 'node:crypto';
import { SessionToken } from '../../domain/value-objects/session-token.js';

export function generateSessionToken(): SessionToken {
  return new SessionToken(randomBytes(32).toString('base64url'));
}
