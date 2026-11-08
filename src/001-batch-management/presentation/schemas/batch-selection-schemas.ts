/**
 * Zod schemas for the batch selection's boundary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO OPERATOR FIELD, AND NO METHOD FIELD. THE SCHEMA HAS NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two facts are recorded in the selection — the operator and the method —
 * and **neither** may be supplied by the client.
 *
 * THE OPERATOR
 * ------------
 * The operator comes from the **session**. A body field would let a
 * request credit the selection to somebody who was not at the station, and
 * the selection is an immutable traceability record (ADR-029) — a false
 * attribution could only ever be contradicted, never corrected. This is
 * the same rule the OrgaTEX write path established (ADR-005).
 *
 * THE METHOD
 * ----------
 * The method is **derived** from the request's shape: a `code` came from
 * the scanner, a `batchId` came from a touched row. A client that could
 * choose the method could record a scan that never happened (ADR-030).
 *
 * Zod's default object behaviour is to **strip** unknown keys, so a client
 * that sends `operatorId` or `selectionMethod` has them dropped — not
 * ignored, but dropped, because the fields do not exist. The schema is
 * the enforcement.
 *
 * EXACTLY ONE OF THE TWO
 * ----------------------
 * A body with both, or with neither, is a `400`. There is no default and
 * no precedence rule: "both" is a client bug, and "neither" is a client
 * bug, and a bug that is silently resolved is a bug that becomes a
 * feature.
 */
import { z } from 'zod';

/** An identifier: bounded, non-empty. */
const identifier = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(64, 'must not exceed 64 characters');

/**
 * The selection's body.
 *
 * Note what is **absent**: `operatorId` and `selectionMethod`.
 *
 * - `operatorId` — comes from the session.
 * - `selectionMethod` — is **derived** from which field is present.
 */
export const batchSelectionSchema = z
  .object({
    /** The batch the operator **touched** in the queue. */
    batchId: identifier.optional(),
    /** The code the operator **scanned**. */
    code: identifier.optional(),
  })
  .refine(
    (body) => (body.batchId === undefined) !== (body.code === undefined),
    {
      message: 'must carry exactly one of batchId or code',
      path: ['body'],
    },
  );

export type BatchSelectionBody = z.infer<typeof batchSelectionSchema>;

/**
 * The queue filter's query parameter.
 *
 * An **optional** status. When it is absent, the filter is off ("All").
 *
 * The status is validated against the MES's **closed set**, so an unknown
 * status is a `400` rather than a silently ignored parameter — the story
 * forbids mapping an unrecognised status to "All" (ADR-030).
 *
 * The empty string is NOT "All": it is a client that sent a status and it
 * was not one. An absent parameter is the only way to say "All", so
 * "All" has exactly one spelling.
 */
export const queueFilterSchema = z.enum([
  'QUEUED',
  'RELEASED',
  'WEIGHING',
  'WEIGHED',
  'CANCELLED',
]);

export type QueueFilterParam = z.infer<typeof queueFilterSchema>;
