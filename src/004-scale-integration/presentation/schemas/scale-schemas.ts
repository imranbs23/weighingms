/**
 * Zod schemas for the scale unit's boundary.
 *
 * QUANTITIES ARE STRINGS
 * ----------------------
 * A JSON number is an IEEE-754 double in every parser, and BRD NFR-16
 * forbids floating point for quantities (ADR-008). The schemas therefore
 * accept a decimal STRING and reject a number — so the boundary rejects
 * the wrong shape rather than silently accepting and rounding it.
 */
import { z } from 'zod';

/** A fixed-point decimal, as a string. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, {
    message: 'must be a fixed-point decimal string, e.g. "93.42"',
  });

export const scaleIdSchema = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(64, 'must not exceed 64 characters');

/**
 * The component id.
 *
 * Bounded in length for the same reason `scaleIdSchema` is: it arrives
 * from a request body and is carried in an event payload, a log line and
 * the selection record, so an unbounded string is an unbounded thing to
 * carry around.
 */
export const componentIdSchema = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(64, 'must not exceed 64 characters');

/**
 * The unit a quantity is expressed in.
 *
 * A CLOSED SET, so an unknown unit is refused at the boundary rather
 * than reaching a converter that would have to guess what it means.
 */
export const unitSchema = z
  .enum(['g', 'kg', 'mg'])
  .describe('the unit the quantity is expressed in');

/**
 * The tare request.
 *
 * The `unit` is NOT obeyed — the value is converted into the DEVICE's
 * own unit before it is applied. The unit is still required, because a
 * bare number's unit is a guess.
 *
 * `appliedAt` is deliberately ABSENT: it is stamped by the server,
 * because a client-supplied timestamp would let a caller forge the
 * tare's history.
 */
export const tareRequestSchema = z.object({
  tareValue: decimalString,
  unit: unitSchema,
  source: z.enum(['CONTAINER_MASTER', 'WEIGHED_EMPTY_CONTAINER']),
});

/**
 * The scale-selection request.
 *
 * The `unit` is the unit the TARGET is expressed in. It is converted
 * into the capacities' unit inside the rule, exactly.
 */
export const selectionRequestSchema = z.object({
  componentId: componentIdSchema,
  target: decimalString,
  unit: unitSchema,
  demandedClass: z.enum(['PRECISION', 'FLOOR']),
});

/** The training control that silences or revives a scale. */
export const linkControlSchema = z.object({
  state: z.enum(['CONNECTED', 'DISCONNECTED']),
});

/** The training control that drives the dispersion ramp. */
export const dispenseControlSchema = z.object({
  target: decimalString,
  tolerance: decimalString,
  landing: z.enum(['IN_TOLERANCE', 'OVER_TOLERANCE']),
});

export type LinkControlBody = z.infer<typeof linkControlSchema>;
export type DispenseControlBody = z.infer<typeof dispenseControlSchema>;
export type TareRequestBody = z.infer<typeof tareRequestSchema>;
export type SelectionRequestBody = z.infer<typeof selectionRequestSchema>;
