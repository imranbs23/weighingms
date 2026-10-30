/**
 * Zod request schemas for the identity API.
 *
 * NOTE ON ERROR DETAIL: a validation error describes the SHAPE OF THE
 * REQUEST — "operatorId is required", "secret is too short" — and never the
 * state of the credential store. It cannot disclose whether an identity
 * exists.
 *
 * A malformed request is rejected with 400 BEFORE the credential store is
 * consulted. That is a deliberate exception to the constant-response rule,
 * and it is safe because the caller already knows their own request was
 * malformed. The rule "one response for all credential failures" governs
 * failures OF AUTHENTICATION, not malformed requests.
 */
import { z } from 'zod';

export const signInSchema = z.object({
  operatorId: z
    .string()
    .min(1, 'operatorId is required')
    .max(64, 'operatorId must not exceed 64 characters'),
  secret: z
    .string()
    .min(1, 'secret is required')
    .max(256, 'secret must not exceed 256 characters'),
});

export const signOutSchema = z.object({
  token: z.string().min(1, 'token is required').max(512),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignOutInput = z.infer<typeof signOutSchema>;
