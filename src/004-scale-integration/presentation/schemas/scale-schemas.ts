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
