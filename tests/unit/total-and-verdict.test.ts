/**
 * The total dispensed, and the tolerance verdict — unit 003, bolt 018.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CONVERT, THEN SUM. IN ONE UNIT. IN FIXED-POINT DECIMAL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's own worked example is the test: **`500.0 g` + `24.000 kg` =
 * `24.500 kg`**.
 */
import { describe, it, expect } from 'vitest';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  TotalDispensedCalculator,
  TOTAL_UNIT,
} from '../../src/003-weighing-station/domain/services/total-dispensed-calculator.js';
import {
  toleranceVerdict,
} from '../../src/003-weighing-station/domain/entities/batch-summary.js';

describe('the total dispensed', () => {
  const calculator = new TotalDispensedCalculator();

  it('is reported in KILOGRAMS', () => {
    const total = calculator.total([WeightValue.of('24.0000', 'kg')]);
    expect(total.unit).toBe(TOTAL_UNIT);
  });

  it('sums grams and kilograms — the story’s worked example', () => {
    // 500.0 g + 24.000 kg = 24.500 kg
    const total = calculator.total([
      WeightValue.of('500.0000', 'g'),
      WeightValue.of('24.0000', 'kg'),
    ]);

    expect(total.text).toBe('24.5000');
    expect(total.unit).toBe('kg');
  });

  it('CONVERTS before it sums — so the order does not matter', () => {
    const grams = WeightValue.of('500.0000', 'g');
    const kilos = WeightValue.of('24.0000', 'kg');

    expect(calculator.total([grams, kilos]).text).toBe(
      calculator.total([kilos, grams]).text,
    );
  });

  it('the conversion is EXACT — never a float artefact', () => {
    // 0.5 kg is 500 g — not 499.9999999 g.
    const total = calculator.total([WeightValue.of('0.5000', 'kg')]);
    expect(total.text).toBe('0.5000');
  });

  it('sums the recipe’s own quantities correctly', () => {
    // DYE-4471-B 1240 g, DYE-2204-R 386 g, DYE-4471-Y 94 g,
    // AUX-0101 24 kg, AUX-0107 9.6 kg.
    const total = calculator.total([
      WeightValue.of('1240.0000', 'g'),
      WeightValue.of('386.0000', 'g'),
      WeightValue.of('94.0000', 'g'),
      WeightValue.of('24.0000', 'kg'),
      WeightValue.of('9.6000', 'kg'),
    ]);

    // 1720 g + 33.6 kg = 35.320 kg
    expect(total.text).toBe('35.3200');
    expect(total.unit).toBe('kg');
  });

  it('is ZERO for an empty set — and never undefined', () => {
    const total = calculator.total([]);
    expect(total.text).toBe('0.0000');
  });

  it('refuses an unknown unit rather than silently omitting it', () => {
    expect(() =>
      calculator.total([WeightValue.of('1.0000', 'stone')]),
    ).toThrow(/Cannot convert/);
  });
});

describe('the tolerance verdict', () => {
  it('is YES when EVERY confirmed weighing was in the OK zone', () => {
    expect(toleranceVerdict(['OK', 'OK', 'OK'])).toBe('YES');
  });

  it('is NO when ONE was not — and it is two-valued, never partial', () => {
    expect(toleranceVerdict(['OK', 'OVER', 'OK'])).toBe('NO');
    expect(toleranceVerdict(['NEAR'])).toBe('NO');
    expect(toleranceVerdict(['UNDER'])).toBe('NO');
  });

  it('an authorised override makes it NO — because its zone is OVER', () => {
    // A component confirmed under a supervisor override carries the
    // OVER-DOSE zone (bolt 016), so the verdict reads it and says NO.
    expect(toleranceVerdict(['OK', 'OK', 'OVER'])).toBe('NO');
  });

  it('is NO for an empty set — nothing has been shown to be within tolerance', () => {
    expect(toleranceVerdict([])).toBe('NO');
  });
});
