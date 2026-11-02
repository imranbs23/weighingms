/**
 * Unit tests for the exact unit conversion — bolt 004.
 *
 * WHY THIS TYPE IS PROVED AT THE BOUNDARY
 * ---------------------------------------
 * The converter exists because a container master holds a tare of `1.850 kg`
 * and the precision scale reports grams. The tare has to arrive as
 * `1850 g` — EXACTLY. A float conversion would put `1849.9999999` on the
 * scale, and every reading after it would be wrong by a fraction of a gram
 * that nobody could see but everybody would inherit.
 *
 * So the cases below are the ones where a float would show itself:
 *
 *   - `1.850 kg` → `1850 g`, not `1849.9999999 g`
 *   - `1850.000000 g` → `1850 g`, not `1850.0 g` (the trailing DOT goes
 *     with the zeros)
 *   - `0.5 g` → `0.0005 kg`, keeping its leading zero
 *
 * BRD NFR-16 forbids floating point for quantities, and this is where the
 * rule is either honoured or quietly broken.
 */
import { describe, it, expect } from 'vitest';
import {
  WeightUnitConverter,
  GRAMS_PER_UNIT,
  SUPPORTED_UNITS,
} from '../../src/004-scale-integration/domain/services/weight-unit-converter.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';

const converter = new WeightUnitConverter();

function convert(text: string, from: string, to: string): WeightValue {
  return converter.convert(WeightValue.of(text, from), to);
}

describe('the unit set is CLOSED', () => {
  it('supports exactly grams, kilograms and milligrams', () => {
    expect([...SUPPORTED_UNITS].sort()).toEqual(['g', 'kg', 'mg']);
  });

  it('publishes the conversion factors', () => {
    expect(GRAMS_PER_UNIT['g']).toBe('1');
    expect(GRAMS_PER_UNIT['kg']).toBe('1000');
    expect(GRAMS_PER_UNIT['mg']).toBe('0.001');
  });

  it('says it supports a known unit', () => {
    expect(converter.supports('kg')).toBe(true);
  });

  it('says it does NOT support an unknown unit', () => {
    expect(converter.supports('lb')).toBe(false);
  });

  it('ignores surrounding whitespace when checking a unit', () => {
    expect(converter.supports('  kg  ')).toBe(true);
  });

  it('does NOT accept an inherited property as a unit', () => {
    // "toString" is a property every object has. A converter that used
    // `unit in GRAMS_PER_UNIT` would treat it as a unit.
    expect(converter.supports('toString')).toBe(false);
    expect(converter.supports('constructor')).toBe(false);
  });
});

describe('the conversion is EXACT — never a float', () => {
  it('converts 1.850 kg to 1850 g exactly', () => {
    const result = convert('1.850', 'kg', 'g');
    expect(result.text).toBe('1850');
    expect(result.unit).toBe('g');
  });

  it('converts 3 kg to 3000 g exactly', () => {
    expect(convert('3', 'kg', 'g').text).toBe('3000');
  });

  it('converts 1850 g to 1.85 kg exactly', () => {
    const result = convert('1850', 'g', 'kg');
    expect(result.text).toBe('1.85');
    expect(result.unit).toBe('kg');
  });

  it('converts 500 mg to 0.5 g exactly', () => {
    expect(convert('500', 'mg', 'g').text).toBe('0.5');
  });

  it('converts 0.5 g to 500 mg exactly', () => {
    expect(convert('0.5', 'g', 'mg').text).toBe('500');
  });

  it('converts 1 mg to 0.000001 kg — the widest step in the set', () => {
    expect(convert('1', 'mg', 'kg').text).toBe('0.000001');
  });

  it('converts 0.000001 kg back to 1 mg exactly', () => {
    expect(convert('0.000001', 'kg', 'mg').text).toBe('1');
  });
});

describe('the trailing zeros a conversion introduces are stripped', () => {
  it('strips the trailing DOT along with the zeros', () => {
    // "1850.000000" must become "1850", never "1850.0".
    const result = convert('1.85', 'kg', 'g');
    expect(result.text).toBe('1850');
    expect(result.text).not.toContain('.');
  });

  it('keeps the leading zero on a value below one', () => {
    const result = convert('0.5', 'g', 'kg');
    expect(result.text).toBe('0.0005');
    expect(result.text.startsWith('0.')).toBe(true);
  });

  it('never produces a bare leading dot', () => {
    const result = convert('1', 'mg', 'kg');
    expect(result.text.startsWith('.')).toBe(false);
    expect(result.text).toBe('0.000001');
  });

  it('converts zero to zero', () => {
    expect(convert('0', 'kg', 'g').text).toBe('0');
  });
});

describe('a conversion to the SAME unit is the identity', () => {
  it('returns the value unchanged', () => {
    const value = WeightValue.of('93.4', 'g');
    const result = converter.convert(value, 'g');

    expect(result.text).toBe('93.4');
    expect(result.unit).toBe('g');
  });

  it('does not rewrite the trailing zeros of the original', () => {
    // "93.40" may be the device's own resolution. Rewriting it would
    // fabricate a precision the device did not report.
    const result = converter.convert(WeightValue.of('93.40', 'g'), 'g');
    expect(result.text).toBe('93.40');
  });
});

describe('an unsupported unit is REFUSED, not assumed', () => {
  it('refuses to convert TO an unsupported unit', () => {
    expect(() => convert('100', 'g', 'lb')).toThrow(/Unsupported unit "lb"/);
  });

  it('refuses to convert FROM an unsupported unit', () => {
    // A conversion factor is an assumption about what a unit means, and an
    // unrecognised unit must not be silently treated as grams.
    expect(() => convert('100', 'lb', 'g')).toThrow(/Unsupported unit "lb"/);
  });

  it('refuses a unit that is only whitespace', () => {
    expect(() => convert('100', 'g', '   ')).toThrow(/Unsupported unit/);
  });
});
