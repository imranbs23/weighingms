/**
 * The quantity formatter — the client's ONLY arithmetic.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FORMATTED FROM A FIXED-POINT STRING. NEVER PARSED AS A FLOAT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Decimals: 1 dp for grams, 3 dp for kilograms, per the prototype's
 * `dp()` rule. Quantities are **formatted**, never parsed as a float — the
 * client receives fixed-point decimal values"* (NFR-2, BRD NFR-16).
 *
 * **And the consequence is that the client must not use `parseFloat`.**
 * It loses the trailing places, and adding two such values gives a result
 * that is not the sum — and the client is exactly where an operator reads
 * a number they will weigh against.
 *
 * So the formatter uses `decimal.js` — **the same library the server
 * uses** — and it works on the string it was given.
 *
 * **AND THE FIGURES BELOW ARE NOT THE MES's.** They are arbitrary
 * well-formed examples — because the client must not carry the MES's
 * quantities, **not even as documentation**.
 */
import { Decimal } from 'decimal.js';

/**
 * The display precision, by unit.
 *
 * **1 dp for grams, 3 dp for kilograms** — the prototype's rule.
 *
 * And it is a **closed set**, so an unknown unit has a defined answer
 * rather than a silent fallback.
 */
export const DISPLAY_PRECISION: Readonly<Record<string, number>> = {
  g: 1,
  kg: 3,
  mg: 3,
};

/** The precision used when the unit is not one the design knows. */
export const FALLBACK_PRECISION = 3;

/**
 * Format a quantity for display.
 *
 * @param text The fixed-point decimal string — **the server's own**.
 * @param unit The unit — **the API's**, never converted by the client.
 */
export function formatQuantity(text: string, unit: string): string {
  const places = DISPLAY_PRECISION[unit] ?? FALLBACK_PRECISION;
  return new Decimal(text).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/**
 * The unit a quantity is displayed in — and it is the API's.
 *
 * **The client does not convert.** The edge case is explicit: *"the unit
 * conversion is performed server-side; the client formats and displays the
 * unit the API reports and does not convert."*
 */
export function displayUnit(unit: string): string {
  return unit;
}

/**
 * Compare two quantities — **exactly**, for the rail and the band.
 *
 * The comparison is in **fixed-point decimal**, so a weight exactly on the
 * band's edge compares as equal rather than as a hair above or below.
 */
export function compareQuantities(
  left: string,
  right: string,
): 'LT' | 'EQ' | 'GT' {
  const a = new Decimal(left);
  const b = new Decimal(right);
  if (a.lessThan(b)) return 'LT';
  if (a.greaterThan(b)) return 'GT';
  return 'EQ';
}

/**
 * A quantity's position within a range — as a percentage, for the band.
 *
 * **And it is clamped**, because the bar is scaled against the scale's
 * **maximum capacity**, and a weight beyond it would draw outside the
 * track.
 */
export function positionInRange(
  value: string,
  lower: string,
  upper: string,
): number {
  const span = new Decimal(upper).minus(lower);
  if (span.isZero()) return 0;

  const offset = new Decimal(value).minus(lower);
  const ratio = offset.dividedBy(span).times(100);

  if (ratio.lessThan(0)) return 0;
  if (ratio.greaterThan(100)) return 100;
  return ratio.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}
