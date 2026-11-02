/**
 * ScaleId — the identity of a physical scale indicator.
 *
 * Opaque and non-empty. Two devices are the same device iff their ids
 * match. The id carries no meaning — "SCALE-A" and "SCALE-B" are the
 * prototype's labels, not a class or a capacity.
 */
export class ScaleId {
  private constructor(readonly value: string) {}

  static create(raw: string): ScaleId {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('ScaleId must not be empty');
    }
    if (value.length > 64) {
      throw new Error('ScaleId must not exceed 64 characters');
    }
    return new ScaleId(value);
  }

  equals(other: ScaleId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
