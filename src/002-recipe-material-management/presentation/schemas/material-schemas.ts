/**
 * The schemas for the material identity and the lot capture.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO operatorId FIELD, AND NO METHOD FIELD. THE SCHEMA HAS NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two facts are recorded — the **operator** and the **method** — and
 * **neither** may be supplied by the client.
 *
 * THE OPERATOR
 * ------------
 * The operator comes from the **session**. A body field would let a
 * request credit the capture to somebody who was not at the station — and
 * the identity and the lot are immutable traceability records, so a false
 * attribution could only ever be contradicted, never corrected (ADR-005,
 * ADR-034).
 *
 * THE METHOD
 * ----------
 * The method is **derived from the request's shape**: a `code` came from
 * the scanner, a `lotNumber` was keyed in, an `attestation` was confirmed
 * on screen. A client that could choose the method could record a scan
 * that never happened — and a scan is the **stronger** claim, because it
 * says the machine read a label (ADR-030, ADR-034).
 *
 * Zod's default object behaviour is to **strip** unknown keys, so a client
 * that sends `operatorId`, `verifiedBy` or `captureMethod` has them
 * dropped — not ignored, but dropped, because the fields do not exist.
 * The schema is the enforcement.
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
 * The identity verification's body.
 *
 * Note what is **absent**: `operatorId` and `verifiedBy`.
 *
 * - `operatorId` — comes from the session.
 * - `verifiedBy` — is **derived** from which field is present.
 */
export const materialIdentitySchema = z
  .object({
    /** The recipe slot being verified. */
    componentId: identifier,
    /** The code the **scanner** read. Its presence means `SCAN`. */
    code: identifier.optional(),
    /**
     * The operator's on-screen confirmation.
     *
     * Its presence means `ATTESTATION`, and the object must actually
     * carry a claim — an empty attestation would be an assertion of
     * nothing, and the story refuses an attestation without an explicit
     * confirmation.
     */
    attestation: z
      .object({
        /** The dyestuff code the operator confirmed on screen. */
        dyestuffCode: identifier,
      })
      .strict()
      .optional(),
  })
  .refine(
    (body) => (body.code === undefined) !== (body.attestation === undefined),
    {
      message: 'must carry exactly one of code or attestation',
      path: ['body'],
    },
  );

export type MaterialIdentityBody = z.infer<typeof materialIdentitySchema>;

/**
 * The lot capture's body.
 *
 * Note what is **absent**: `operatorId` and `captureMethod`.
 *
 * - `operatorId` — comes from the session.
 * - `captureMethod` — is **derived** from which field is present.
 */
export const materialLotSchema = z
  .object({
    /** The recipe slot the lot is captured against. */
    componentId: identifier,
    /** The lot the operator **keyed in**. Its presence means `KEYED_IN`. */
    lotNumber: identifier.optional(),
    /** The lot the **scanner** read. Its presence means `SCAN`. */
    code: identifier.optional(),
  })
  .refine(
    (body) => (body.lotNumber === undefined) !== (body.code === undefined),
    {
      message: 'must carry exactly one of lotNumber or code',
      path: ['body'],
    },
  );

export type MaterialLotBody = z.infer<typeof materialLotSchema>;
