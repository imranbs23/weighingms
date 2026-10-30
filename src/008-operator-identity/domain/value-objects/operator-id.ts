/**
 * OperatorId — the identity as presented at the terminal.
 *
 * This is the credential namespace: the badge ID. It is compared EXACTLY,
 * with no case folding and no trimming beyond the validation below. Case
 * folding would merge two distinct badges ("RK-01" and "rk-01") into one
 * identity, which would let one operator sign in as another.
 */
export class OperatorId {
  private constructor(readonly value: string) {}

  static create(raw: string): OperatorId {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('OperatorId must not be empty');
    }
    if (value.length > 64) {
      throw new Error('OperatorId must not exceed 64 characters');
    }
    return new OperatorId(value);
  }

  equals(other: OperatorId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
