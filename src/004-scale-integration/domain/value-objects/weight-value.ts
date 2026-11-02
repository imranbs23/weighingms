/**
 * WeightValue — a fixed-point decimal weight.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CONSTRUCTOR ACCEPTS A STRING AND NOTHING ELSE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the structural expression of BRD NFR-16 ("floating point is not
 * permitted for quantities"). A JavaScript `number` cannot be passed here,
 * not by convention and not by runtime checking — the type system rejects
 * it. There is no overload that takes a number.
 *
 * The reason it is a string rather than a `number` wrapped in a class is
 * that `new WeightValue(93.42)` is the mistake we are preventing, and the
 * only way to make it impossible rather than merely discouraged is to make
 * it a type error.
 *
 * THE CANONICAL FORM
 * ------------------
 *   - no exponent ("1e3" is rejected — it is a float's notation)
 *   - no leading `+`
 *   - no bare leading `.` ("0.5", never ".5")
 *   - no trailing "." ("5.", never "5.")
 *   - no leading zeros beyond a single "0" ("0.5" is fine, "00.5" is not)
 *   - negative values ARE allowed — a scale can read below zero
 *
 * Trailing zeros are PRESERVED. "93.40" is not rewritten to "93.4",
 * because the trailing zero may be the device's own resolution and
 * rewriting it would fabricate a precision the device did not report.
 *
 * WHY NOT `decimal.js` HERE?
 * --------------------------
 * Because this type does not do arithmetic. It compares, it carries a
 * unit, and it serialises. `decimal.js` is used where quantities are
 * actually COMPUTED (the ramp, and in bolt 004 the tolerance and capacity
 * comparisons) — and it is used to produce the string that goes in here.
 * Keeping arithmetic out of this type keeps the common path — a reading
 * arriving, being compared, being serialised — free of a decimal library
 * entirely.
 */
export class WeightValue {
  private constructor(
    readonly text: string,
    readonly unit: string,
  ) {}

  /**
   * Create a weight from a decimal string.
   *
   * @param text  A fixed-point decimal, e.g. "93.42" or "0" or "-1.5".
   * @param unit  The unit the value is expressed in, e.g. "g" or "kg".
   */
  static of(text: string, unit: string): WeightValue {
    const trimmed = text.trim();
    if (!isCanonicalDecimal(trimmed)) {
      throw new Error(
        `WeightValue must be a fixed-point decimal string, got "${text}"`,
      );
    }
    const normalisedUnit = unit.trim();
    if (normalisedUnit.length === 0) {
      throw new Error('WeightValue must carry a unit');
    }
    return new WeightValue(trimmed, normalisedUnit);
  }

  /**
   * Compare two weights that are in the SAME unit.
   *
   * Comparing across units is refused rather than converted. A conversion
   * needs a factor, and a factor is an assumption about what the device
   * means — the unit brief's own rule is that "the value is not silently
   * reinterpreted in the old unit".
   */
  compareTo(other: WeightValue): -1 | 0 | 1 {
    if (other.unit !== this.unit) {
      throw new Error(
        `Cannot compare weights in different units (${this.unit} vs ${other.unit})`,
      );
    }
    if (this.text === other.text) return 0;

    // Compare as exact integers at a COMMON scale.
    //
    // The common scale is the point: "93.4" and "93.40" are the same
    // quantity, so both must be expressed at the same number of decimal
    // places before they are compared. Scaling each by its OWN fraction
    // length would compare 934 against 9340 and call them different.
    const a = splitDecimal(this.text);
    const b = splitDecimal(other.text);
    const places = Math.max(a.fraction.length, b.fraction.length);
    const scale = 10n ** BigInt(places);

    const aInt = scaledInteger(a, places, scale);
    const bInt = scaledInteger(b, places, scale);

    if (aInt < bInt) return -1;
    if (aInt > bInt) return 1;
    return 0;
  }

  equals(other: WeightValue): boolean {
    return this.compareTo(other) === 0;
  }

  isZero(): boolean {
    return this.compareTo(WeightValue.of('0', this.unit)) === 0;
  }

  isNegative(): boolean {
    return this.compareTo(WeightValue.of('0', this.unit)) < 0;
  }

  /** The value as it appears on the wire — a JSON string, never a number. */
  toJSON(): string {
    return this.text;
  }

  toString(): string {
    return `${this.text} ${this.unit}`;
  }
}

/**
 * Is this a canonical fixed-point decimal?
 *
 * Rejects everything a float's `toString()` might produce (exponent
 * notation) and everything a human might typo.
 */
function isCanonicalDecimal(text: string): boolean {
  if (text.length === 0) return false;

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return false;

  const [, , integer] = match;

  // No leading zeros beyond a single "0" — "00.5" is not canonical.
  if (integer !== undefined && integer.length > 1 && integer.startsWith('0')) {
    return false;
  }

  return true;
}

/** Split a canonical decimal into its sign, integer and fraction parts. */
function splitDecimal(text: string): {
  negative: boolean;
  integer: string;
  fraction: string;
} {
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const integer = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);

  return { negative, integer, fraction };
}

/**
 * The value as an exact integer at the COMMON scale, with the sign
 * applied.
 *
 * The fraction is right-padded with zeros to the common number of
 * places, so "93.4" at two places becomes 9340 and "93.40" at two
 * places is also 9340.
 */
function scaledInteger(
  parts: { negative: boolean; integer: string; fraction: string },
  places: number,
  scale: bigint,
): bigint {
  const padded = parts.fraction.padEnd(places, '0');
  const magnitude =
    BigInt(parts.integer) * scale + (padded === '' ? 0n : BigInt(padded));
  return parts.negative ? -magnitude : magnitude;
}
