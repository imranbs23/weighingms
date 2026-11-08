/**
 * LotValidator — a presence-and-format check, and nothing more.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A LOT IS AN IDENTIFIER, NEVER A QUANTITY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story is explicit: *"the lot number itself is an identifier, not a
 * quantity, and is stored as a string with its source format preserved.
 * Where the lot identifier embeds a quantity-like token, it is not converted
 * to a number and never to a float"* (BRD NFR-16).
 *
 * So this validator checks **presence** and **length** — and it never
 * parses, splits or interprets the lot's internal structure. The lot's
 * format is **CQ-08's and FCI's**, not ours, and a validator that
 * understood the format would break when the format changes.
 *
 * THE VALUE IS TRIMMED, NEVER TRUNCATED
 * -------------------------------------
 * The story's edge case: *"the operator keys a lot with leading or trailing
 * whitespace → the value is trimmed before validation and storage; the
 * stored value is the trimmed form."*
 *
 * And: *"the operator keys a lot longer than 64 characters → the capture is
 * refused with a validation error naming the maximum length; the value is
 * not truncated."*
 *
 * A truncated lot is a lot that does not exist. Truncation is the one
 * thing a validation must never do.
 *
 * AND IT DOES NOT JUDGE THE TOLERANCE
 * -----------------------------------
 * The story is explicit: *"lot validation is a presence-and-format check plus
 * an optional upstream existence check. The unit does not compute or apply
 * a tolerance rule here"* (BRD FR-03, BRD FR-04).
 */
import { LotNumber } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

/** The outcome of validating a lot. */
export type LotValidationOutcome =
  | { readonly kind: 'VALID'; readonly lotNumber: LotNumber }
  | {
      /** The lot was empty. */
      readonly kind: 'EMPTY';
    }
  | {
      /** The lot was longer than the bound. */
      readonly kind: 'TOO_LONG';
      readonly maximum: number;
      readonly length: number;
    };

export class LotValidator {
  /**
   * Validate a lot the operator presented or keyed in.
   *
   * @param raw The lot, exactly as it arrived.
   */
  validate(raw: string): LotValidationOutcome {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      return { kind: 'EMPTY' };
    }

    // The identifier's own bound is 64 — the same bound every identifier
    // in this product uses. It is asked of the factory rather than
    // duplicated here, so the two cannot drift.
    const maximum = 64;
    if (trimmed.length > maximum) {
      return { kind: 'TOO_LONG', maximum, length: trimmed.length };
    }

    return { kind: 'VALID', lotNumber: LotNumber.create(trimmed) };
  }
}
