/**
 * OperatorRole — exactly two values.
 *
 * This is a CLOSED union, not a string. The set of roles is what authorises
 * privileged actions, so it is deliberately not extensible at runtime: adding
 * a third role would silently widen what a credential can do. The database
 * carries a matching CHECK constraint, so the bound is enforced by the type
 * system AND by the storage layer.
 */
export const OPERATOR_ROLE_OPERATOR = 'OPERATOR';
export const OPERATOR_ROLE_SUPERVISOR = 'SUPERVISOR';

export type OperatorRoleValue =
  | typeof OPERATOR_ROLE_OPERATOR
  | typeof OPERATOR_ROLE_SUPERVISOR;

export class OperatorRole {
  private constructor(readonly value: OperatorRoleValue) {}

  static operator(): OperatorRole {
    return new OperatorRole(OPERATOR_ROLE_OPERATOR);
  }

  static supervisor(): OperatorRole {
    return new OperatorRole(OPERATOR_ROLE_SUPERVISOR);
  }

  /**
   * Reconstruct a role from persisted data.
   *
   * This THROWS on an unknown value rather than defaulting. Defaulting would
   * turn a corrupted role into OPERATOR — the less privileged role — and
   * would hide the corruption. Throwing is the safe failure: the value
   * cannot be silently misinterpreted.
   */
  static fromStored(raw: string): OperatorRole {
    if (raw === OPERATOR_ROLE_OPERATOR) return new OperatorRole(OPERATOR_ROLE_OPERATOR);
    if (raw === OPERATOR_ROLE_SUPERVISOR) return new OperatorRole(OPERATOR_ROLE_SUPERVISOR);
    throw new Error(`Unknown operator role: ${raw}`);
  }

  isSupervisor(): boolean {
    return this.value === OPERATOR_ROLE_SUPERVISOR;
  }

  equals(other: OperatorRole): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
