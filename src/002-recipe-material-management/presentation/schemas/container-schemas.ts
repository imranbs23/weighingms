/**
 * The schema for the container assignment's boundary.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THERE IS NO operatorId, NO assignmentMethod, NO tareValue AND NO
 * tareSource. THE SCHEMA HAS NONE OF THEM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four facts are recorded — the operator, the method, the tare value and
 * the tare source — and **none** of them may be supplied by the client.
 *
 * THE OPERATOR
 * ------------
 * From the **session**. A body field would let a request credit the
 * assignment to somebody who was not at the station — and the assignment is
 * an immutable traceability record, so a false attribution could only ever
 * be contradicted, never corrected (ADR-005, ADR-035).
 *
 * THE METHOD
 * ----------
 * **Derived from the request's shape**: a `code` came from the scanner, a
 * `containerId` was typed in. A client that could choose the method could
 * record a scan that never happened (ADR-030).
 *
 * THE TARE VALUE
 * --------------
 * **There is no field for it at all.** A measured tare is the **scale's**
 * reading — the empty container put on the device and read. A client-chosen
 * tare would be a client-chosen tolerance boundary (ADR-035).
 *
 * THE TARE SOURCE
 * ---------------
 * Also **derived**: only the station knows whether the value came from the
 * master (a claim) or from the empty container (a measurement). A client
 * that could claim `CONTAINER_MASTER` would be claiming a measurement was
 * a reference value — and the audit trail would then be wrong about which
 * kind of evidence produced the quantity.
 *
 * Zod's default object behaviour is to **strip** unknown keys, so a client
 * that sends any of the four has them dropped — not ignored, but dropped,
 * because the fields do not exist. The schema is the enforcement.
 */
import { z } from 'zod';

/** An identifier: bounded, non-empty. */
const identifier = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(64, 'must not exceed 64 characters');

/**
 * The assignment's body.
 *
 * Note what is **absent**: `operatorId`, `assignmentMethod`, `tareValue`
 * and `tareSource`.
 */
export const containerAssignmentSchema = z
  .object({
    /** The recipe slot the container is assigned to. */
    componentId: identifier,
    /** The container the operator **keyed in**. Its presence means `KEYED_IN`. */
    containerId: identifier.optional(),
    /** The container's code the **scanner** read. Its presence means `SCAN`. */
    code: identifier.optional(),
    /**
     * The device the tare is applied to.
     *
     * It IS a client field, because the device is the **session's** choice
     * — unit `003` selects the scale and the operator does not. The tare
     * cannot be applied without one.
     */
    scaleId: identifier,
  })
  .refine(
    (body) =>
      (body.containerId === undefined) !== (body.code === undefined),
    {
      message: 'must carry exactly one of containerId or code',
      path: ['body'],
    },
  );

export type ContainerAssignmentBody = z.infer<
  typeof containerAssignmentSchema
>;
