/**
 * Operator — an identified person known to the station.
 *
 * The Operator is a STABLE REFERENCE to a person, not a record of what they
 * did. It is the value stamped onto a weighing record and onto an audit
 * entry.
 *
 * Note what it does NOT carry: no secret, no credential, no session state.
 * If it did, every consumer of the operator would inherit a security
 * surface it has no business holding. That is why `Operator` and
 * `Credential` are separate aggregates despite being one-to-one.
 */
import { OperatorId } from '../value-objects/operator-id.js';
import { OperatorRole } from '../value-objects/operator-role.js';

export class Operator {
  constructor(
    readonly id: OperatorId,
    readonly displayName: string,
    readonly role: OperatorRole,
    readonly active: boolean,
    readonly createdAt: Date,
  ) {}

  /**
   * A deactivated operator authorises nothing.
   *
   * This is checked on every authorisation, so deactivation takes effect
   * immediately even for an already-live session.
   */
  isActive(): boolean {
    return this.active;
  }

  isSupervisor(): boolean {
    return this.role.isSupervisor();
  }

  deactivate(): Operator {
    return new Operator(this.id, this.displayName, this.role, false, this.createdAt);
  }

  rename(displayName: string): Operator {
    return new Operator(this.id, displayName, this.role, this.active, this.createdAt);
  }
}
