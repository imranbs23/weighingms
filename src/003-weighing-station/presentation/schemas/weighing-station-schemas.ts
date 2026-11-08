/**
 * The schema for the weighing session's boundary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO scaleId FIELD, AND NO WEIGHT FIELD. THE SCHEMA HAS NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE SCALE
 * ---------
 * BRD BR-05: *"the selection is automatic and requires no operator input."*
 * So the client names the **component** and the rule resolves the scale. A
 * client-supplied `scaleId` would be a client-supplied tolerance boundary
 * — the same argument that removed the tare value from the container
 * assignment (ADR-035).
 *
 * THE WEIGHT
 * ----------
 * There is **no endpoint that accepts a weight**. The weight comes from
 * the device, through unit `004`'s stream. A client that could post a
 * weight could post the weight it wanted.
 */
import { z } from 'zod';

/** An identifier: bounded, non-empty. */
const identifier = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(64, 'must not exceed 64 characters');

/**
 * The component selection's body.
 *
 * Note what is **absent**: `scaleId`. The rule chooses.
 */
export const componentSelectionSchema = z.object({
  /** The recipe slot the operator selected. */
  componentId: identifier,
});

export type ComponentSelectionBody = z.infer<typeof componentSelectionSchema>;
