/**
 * ReadingSequence — a per-device, strictly increasing counter.
 *
 * S-3: a reading whose sequence is not strictly greater than the last
 * accepted one is rejected. The counter belongs to ONE device — two
 * scales may both be at sequence 42 at the same moment, and those are not
 * comparable.
 *
 * The type is an integer, and the class refuses a negative one: a
 * negative sequence would make "strictly increasing" ambiguous at the
 * origin.
 */
export class ReadingSequence {
  private constructor(readonly value: number) {}

  static of(raw: number): ReadingSequence {
    if (!Number.isInteger(raw)) {
      throw new Error('ReadingSequence must be an integer');
    }
    if (raw < 0) {
      throw new Error('ReadingSequence must not be negative');
    }
    return new ReadingSequence(raw);
  }

  /** Is this strictly greater than `other`? */
  isGreaterThan(other: ReadingSequence): boolean {
    return this.value > other.value;
  }

  equals(other: ReadingSequence): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
