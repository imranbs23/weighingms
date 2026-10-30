/**
 * PrivilegedAction — the closed set of actions reserved to a supervisor.
 *
 * WHY A CLOSED SET
 * ----------------
 * The set of privileged actions IS the authorisation surface. If it were a
 * free string, then a typo — or a caller inventing an action name — would
 * create an authorisation for something nobody intended to be authorisable.
 * The set is therefore a closed union, and the database carries a matching
 * CHECK constraint so the bound is enforced by the type system AND by the
 * storage layer.
 *
 * WHERE THE NAMES COME FROM
 * -------------------------
 * FR-21 names three privileged actions — "supervisor authentication is
 * required for tolerance override, manual scale reselection and calibration
 * bypass". Unit 003's story 007 names a fourth — `confirmComponent`, the
 * confirmation of a component under a non-compensable over-dose override.
 *
 * These names are DERIVED from the requirements, not invented. If a later
 * requirement adds a privileged action, it is added here and the CHECK
 * constraint is extended to match.
 */
export const PRIVILEGED_ACTION_CONFIRM_COMPONENT = 'CONFIRM_COMPONENT';
export const PRIVILEGED_ACTION_TOLERANCE_OVERRIDE = 'TOLERANCE_OVERRIDE';
export const PRIVILEGED_ACTION_MANUAL_SCALE_RESELECTION = 'MANUAL_SCALE_RESELECTION';
export const PRIVILEGED_ACTION_CALIBRATION_BYPASS = 'CALIBRATION_BYPASS';

/**
 * The action names, as a runtime array.
 *
 * Exported as an array (not just a type) so the Zod schema at the API
 * boundary can derive its enum from this list. One source of truth: an
 * action cannot be added to the type and forgotten in the schema.
 */
export const PRIVILEGED_ACTION_NAMES = [
  PRIVILEGED_ACTION_CONFIRM_COMPONENT,
  PRIVILEGED_ACTION_TOLERANCE_OVERRIDE,
  PRIVILEGED_ACTION_MANUAL_SCALE_RESELECTION,
  PRIVILEGED_ACTION_CALIBRATION_BYPASS,
] as const;

export type PrivilegedActionValue = (typeof PRIVILEGED_ACTION_NAMES)[number];

export class PrivilegedAction {
  private constructor(readonly value: PrivilegedActionValue) {}

  static of(value: PrivilegedActionValue): PrivilegedAction {
    return new PrivilegedAction(value);
  }

  /**
   * Reconstruct an action from persisted data.
   *
   * This THROWS on an unknown value rather than defaulting. Defaulting
   * would silently widen the authorisation surface — a corrupted row would
   * become an action somebody had never authorised.
   */
  static fromStored(raw: string): PrivilegedAction {
    if ((PRIVILEGED_ACTION_NAMES as readonly string[]).includes(raw)) {
      return new PrivilegedAction(raw as PrivilegedActionValue);
    }
    throw new Error(`Unknown privileged action: ${raw}`);
  }

  equals(other: PrivilegedAction): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
