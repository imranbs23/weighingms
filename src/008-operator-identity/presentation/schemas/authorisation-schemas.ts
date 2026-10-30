/**
 * Zod request schemas for the authorisation API.
 *
 * NOTE ON THE `action` ENUM
 * --------------------------
 * It is DERIVED from `PRIVILEGED_ACTION_NAMES` — the same array the
 * domain's `PrivilegedAction` type is built from. One source of truth: an
 * action cannot be added to the domain type and forgotten in the schema.
 *
 * NOTE ON THE `reason`
 * ---------------------
 * The schema checks that the reason is a STRING and that it is present.
 * It does NOT check that the reason is MEANINGFUL — "not empty, not
 * whitespace, not punctuation-only" is enforced by the domain's
 * `AuthorisationReason` value object, which cannot be constructed without
 * one.
 *
 * The split is deliberate: the domain rule is the rule that matters, and
 * duplicating it here would create two places where it could diverge. A
 * schema-level minimum length would additionally REJECT reasons the domain
 * would accept — "ok per customer" is a legitimate justification — which
 * would be a schema bug, not a security improvement.
 */
import { z } from 'zod';
import { PRIVILEGED_ACTION_NAMES } from '../../domain/value-objects/privileged-action.js';

export const authoriseSchema = z.object({
  supervisorId: z
    .string()
    .min(1, 'supervisorId is required')
    .max(64, 'supervisorId must not exceed 64 characters'),
  secret: z
    .string()
    .min(1, 'secret is required')
    .max(256, 'secret must not exceed 256 characters'),
  action: z.enum(PRIVILEGED_ACTION_NAMES, {
    error: 'action is not a permitted privileged action',
  }),
  subject: z
    .string()
    .min(1, 'subject is required')
    .max(256, 'subject must not exceed 256 characters'),
  // The schema validates the SHAPE of the reason; the DOMAIN validates its
  // MEANING.
  //
  // A blank, whitespace-only or punctuation-only reason passes this schema
  // on purpose. The domain's `AuthorisationReason` rejects it, and the
  // service turns that rejection into the NAMED refusal — `REASON_MISSING`
  // or `REASON_NOT_MEANINGFUL` — which is what the audit trail records.
  //
  // Rejecting it here as a validation error would make those two named
  // reasons unreachable over HTTP, and the story requires a missing reason
  // to be REFUSED (403) rather than merely malformed (400).
  //
  // The length bound stays: a thousand-plus characters is a malformed
  // request, not a missing justification.
  reason: z.string().max(1000, 'reason must not exceed 1000 characters'),
});

export const consumeSchema = z.object({
  action: z.enum(PRIVILEGED_ACTION_NAMES, {
    error: 'action is not a permitted privileged action',
  }),
  subject: z
    .string()
    .min(1, 'subject is required')
    .max(256, 'subject must not exceed 256 characters'),
});

export type AuthoriseInput = z.infer<typeof authoriseSchema>;
export type ConsumeInput = z.infer<typeof consumeSchema>;
