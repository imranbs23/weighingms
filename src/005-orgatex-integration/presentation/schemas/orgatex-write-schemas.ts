/**
 * Zod schemas for the OrgaTEX write path's boundary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO OPERATOR FIELD. THE SCHEMA DOES NOT HAVE ONE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * FR-18 says the consumption posting carries the operator's identity, and
 * the obvious way to do that is to put `operatorId` in the body.
 *
 * That would be a **privilege escalation**: a request could name any
 * operator, and the MES's consumption record would credit the weighing
 * to somebody who was not at the scale.
 *
 * So the operator comes from the **session** — the signed-in operator —
 * and the body has no field for it. Not "the field is ignored": the
 * field **does not exist in the schema**, so it cannot be sent.
 *
 * Zod's default object behaviour is to **strip** unknown keys, so a
 * client that sends `operatorId` gets it dropped rather than honoured.
 * The schema is the enforcement.
 *
 * QUANTITIES ARE STRINGS
 * -----------------------
 * A JSON number is an IEEE-754 double in every parser, and BRD NFR-16
 * forbids floating point for quantities (ADR-008). The schema accepts a
 * decimal STRING and rejects a number — so the boundary rejects the
 * wrong shape rather than silently accepting and rounding it.
 */
import { z } from 'zod';

/** A fixed-point decimal, as a string. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, {
    message: 'must be a fixed-point decimal string, e.g. "93.42"',
  });

/** An identifier: bounded, non-empty. */
const identifier = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(64, 'must not exceed 64 characters');

/**
 * The consumption posting's body.
 *
 * Note what is **absent**: `operatorId`, `idempotencyKey` and `state`.
 *
 * - `operatorId` — comes from the session.
 * - `idempotencyKey` — is **derived** from the weighing's identity. A
 *   client that could choose the key could choose one that collides with
 *   another weighing's, and suppress it.
 * - `state` — is the MES's to decide, not the client's.
 */
export const consumptionPostingSchema = z.object({
  componentId: identifier,
  actualQuantity: decimalString,
  unit: z
    .string()
    .trim()
    .min(1, 'unit is required')
    .max(16, 'unit must not exceed 16 characters'),
  lotNumber: identifier,
  weighedAt: z
    .string()
    .trim()
    .min(1, 'weighedAt is required')
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'weighedAt must be an ISO-8601 instant',
    }),
});

export type ConsumptionPostingBody = z.infer<
  typeof consumptionPostingSchema
>;

/**
 * The batch status write's body.
 *
 * `status` is a **literal**, not an enum of the MES's five statuses. The
 * only status this seam writes is `WEIGHED` (BRD IR-06, C-01), and a
 * schema that admitted `QUEUED` would be a schema that could change an
 * OrgaTEX batch field it has no business changing.
 */
export const batchStatusWriteSchema = z.object({
  status: z.literal('WEIGHED'),
});

export type BatchStatusWriteBody = z.infer<typeof batchStatusWriteSchema>;

/**
 * The Dummy MES's rejection control.
 *
 * A **training control**, so it is explicit about what it does.
 */
export const rejectionControlSchema = z.object({
  reject: z.boolean(),
  /** Which write to refuse — both, or just one. */
  target: z.enum(['CONSUMPTION', 'STATUS', 'BOTH']).default('CONSUMPTION'),
});

/**
 * The Dummy MES's RELEASE control.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MES RELEASES THE BATCH. THE STATION NEVER DOES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD BR-03: *"The business must not permit weighing against a batch
 * OrgaTEX has not released."* So a station may only weigh a batch the MES
 * has released — and the **release is the MES's act**, not the station's.
 *
 * The seed world holds no `RELEASED` batch: `B-24187` is `WEIGHING` (the
 * prototype's selected row) and the other three are `QUEUED`. So without a
 * release the queue has **no selectable row at all**, and the whole
 * downstream flow — the session, the weighing, the ticket — cannot be
 * demonstrated in the running product.
 *
 * So this control lets a training run release a batch. **It is the MES's own
 * surface** — the same place as the outage and refusal controls — and the
 * station's own seam still writes only `WEIGHED` (BRD IR-06, C-01).
 *
 * The status is a **literal**, `RELEASED`, because that is the only release
 * there is. A schema that admitted `WEIGHED` would let a training run
 * pretend the MES had weighed a batch.
 */
export const releaseControlSchema = z.object({
  batchId: identifier,
  status: z.literal('RELEASED'),
});

export type ReleaseControlBody = z.infer<typeof releaseControlSchema>;
