/**
 * WeightUnitConverter — exact unit conversion, as a pure function.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHY IT EXISTS
 * -------------
 * The story's edge case: "The tare value is in kilograms and the device
 * reports grams — the value is converted to fixed-point decimal in the
 * device's unit before it is applied; no floating-point conversion
 * occurs."
 *
 * A container master holds a tare of `1.850 kg`. The precision scale
 * reports grams. The tare has to reach the device as `1850 g`, and the
 * conversion has to be EXACT — a float conversion would put 1849.9999999
 * on the scale, and every reading after it would be wrong by a
 * fraction of a gram that nobody could see but everybody would inherit.
 *
 * WHY THE UNIT IS NOT TRUSTED FROM THE REQUEST
 * ---------------------------------------------
 * The request body's `unit` is NOT obeyed. The value is CONVERTED into
 * the DEVICE's own unit. A request claiming `unit: "kg"` against a
 * gram-reporting device is converted, not obeyed — the device's unit is
 * a fact about the instrument, and the caller does not get to redefine
 * it.
 *
 * TRAILING ZEROS ARE STRIPPED FROM THE RESULT
 * --------------------------------------------
 * The conversion produces a string with the precision it needs, and the
 * trailing zeros that conversion introduces are removed — they are an
 * artefact of the CONVERSION, not the device's resolution. The device's
 * own resolution is re-established when the adapter emits readings in
 * the device's unit.
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../value-objects/weight-value.js';

/**
 * Grams per unit. A CLOSED SET.
 *
 * Only the units the product actually uses are supported, and an
 * unsupported unit is REFUSED rather than assumed. A conversion factor is
 * an assumption about what a unit means, and an unrecognised unit must
 * not be silently treated as grams.
 */
export const GRAMS_PER_UNIT: Readonly<Record<string, string>> = {
  g: '1',
  kg: '1000',
  mg: '0.001',
};

/** The units this converter understands. */
export const SUPPORTED_UNITS: readonly string[] = Object.keys(GRAMS_PER_UNIT);

/**
 * How many decimal places the conversion needs.
 *
 * The widest step between the supported units is mg → kg, a factor of
 * 1,000,000, which adds six decimal places. Six is therefore enough for
 * every supported pair, and the conversion is exact.
 */
const CONVERSION_DECIMAL_PLACES = 6;

export class WeightUnitConverter {
  /**
   * Convert a weight into another unit, exactly.
   *
   * @param value  The weight to convert.
   * @param toUnit The unit to express it in.
   */
  convert(value: WeightValue, toUnit: string): WeightValue {
    const target = toUnit.trim();
    if (!isSupported(target)) {
      throw new Error(`Unsupported unit "${toUnit}"`);
    }

    const from = GRAMS_PER_UNIT[value.unit];
    if (from === undefined) {
      throw new Error(`Unsupported unit "${value.unit}"`);
    }

    if (value.unit === target) {
      return value;
    }

    const grams = new Decimal(value.text).times(from);
    const converted = grams.div(GRAMS_PER_UNIT[target] as string);

    return WeightValue.of(
      stripTrailingZeros(converted.toFixed(CONVERSION_DECIMAL_PLACES)),
      target,
    );
  }

  /** Is this unit one the converter understands? */
  supports(unit: string): boolean {
    return isSupported(unit.trim());
  }
}

/**
 * Remove the trailing zeros a fixed-point conversion introduces.
 *
 * `"1850.000000"` → `"1850"`, `"0.214000"` → `"0.214"`, `"0.000000"` →
 * `"0"`. The result is always a canonical decimal that `WeightValue`
 * accepts.
 *
 * The trailing DOT goes with the zeros: `"1850.000000"` must become
 * `"1850"`, not `"1850.0"`. A value below one keeps its leading zero
 * and at least one decimal place — `"0.5"`, never `".5"`.
 */
function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;

  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  if (trimmed === '' || trimmed === '-') return '0';

  if (trimmed.startsWith('.')) return `0${trimmed}`;
  if (trimmed.startsWith('-.')) return `-0${trimmed.slice(1)}`;

  return trimmed;
}

function isSupported(unit: string): boolean {
  return Object.prototype.hasOwnProperty.call(GRAMS_PER_UNIT, unit);
}
