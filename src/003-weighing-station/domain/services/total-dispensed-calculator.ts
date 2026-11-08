/**
 * TotalDispensedCalculator — the batch's total dispensed.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CONVERT, THEN SUM. IN ONE UNIT. IN FIXED-POINT DECIMAL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The recipe mixes units — the dyestuffs are in grams, the auxiliaries in
 * kilograms — so the total is a sum across two units.
 *
 * **AND EVERY QUANTITY IS CONVERTED BEFORE IT IS ADDED.** Converting
 * before the sum is what makes the result independent of the order: every
 * addition is between two quantities in the same unit, and every
 * intermediate sum is exact.
 *
 * **AND THE CONVERSION IS EXACT.** `0.5 kg` is `500 g`, never
 * `499.9999999 g` — a fraction of a gram that nobody would see and
 * everybody would inherit (BRD NFR-16, C-11).
 *
 * THE THREE WRONG WAYS, AND WHY
 * -----------------------------
 * ```ts
 * // String concatenation — the story's own warning.
 * records.map((r) => r.quantity.text).join('');   // "24.000500.0"
 *
 * // Float addition — NFR-16 forbids it everywhere else in the product.
 * records.reduce((s, r) => s + parseFloat(r.quantity.text), 0);
 *
 * // Right — convert, then add, in fixed-point decimal.
 * ```
 *
 * PURE. NO I/O, NO CLOCK, NO DATABASE.
 */
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';

/** The unit the total is reported in. */
export const TOTAL_UNIT = 'kg';

/**
 * The unit's gram factor — the exact, fixed-point rates.
 *
 * The MES's units, and the conversion between them. A gram is the base.
 */
const GRAMS_PER_UNIT: Readonly<Record<string, string>> = {
  g: '1',
  kg: '1000',
  mg: '0.001',
};

export class TotalDispensedCalculator {
  /**
   * The total dispensed.
   *
   * @param quantities The confirmed records' quantities — **only** the
   *   confirmed ones. An abandoned attempt contributes nothing.
   */
  total(quantities: readonly WeightValue[]): WeightValue {
    let sum = new Decimal(0);

    for (const quantity of quantities) {
      sum = sum.plus(this.convertToGrams(quantity));
    }

    return WeightValue.of(
      this.fromGrams(sum, TOTAL_UNIT).toFixed(4),
      TOTAL_UNIT,
    );
  }

  /**
   * The quantity in grams — the common unit everything is converted to.
   *
   * **The conversion is exact**, and the result is carried at the
   * quantity's own precision — so `0.5 kg` is exactly `500` and not
   * `499.9999999`.
   */
  private convertToGrams(quantity: WeightValue): Decimal {
    const factor = GRAMS_PER_UNIT[quantity.unit];
    if (factor === undefined) {
      // An unknown unit is a REFUSAL, not a silent zero — a total that
      // quietly omitted a component would be worse than a failure.
      throw new Error(`Cannot convert ${quantity.unit} into grams`);
    }
    return new Decimal(quantity.text).times(factor);
  }

  /**
   * Grams into another unit.
   *
   * The division is exact only when the target is a whole multiple of
   * grams — and the total's unit is kilograms, so it is. The result is
   * rounded **half-up** at the storage precision, which is the same rule
   * the compensation factor uses (bolt `015`).
   */
  private fromGrams(grams: Decimal, unit: string): Decimal {
    const factor = GRAMS_PER_UNIT[unit];
    if (factor === undefined) {
      throw new Error(`Cannot convert grams into ${unit}`);
    }
    return grams.dividedBy(factor).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }
}
