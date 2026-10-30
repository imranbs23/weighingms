/**
 * OperatorStamp — the immutable snapshot of the operator attached to a
 * weighing record or an audit entry.
 *
 * This is the value every other unit consumes. Units 003 and 006 read it;
 * they never re-derive it. Because it is taken ONCE, at the moment of the
 * action, a later rename or role change cannot rewrite history
 * (BRD DR-02 — confirmed records are immutable).
 */
import { OperatorId } from './operator-id.js';
import { OperatorRole } from './operator-role.js';

export class OperatorStamp {
  constructor(
    readonly operatorId: OperatorId,
    readonly displayName: string,
    readonly role: OperatorRole,
  ) {}

  static fromOperator(operator: {
    id: OperatorId;
    displayName: string;
    role: OperatorRole;
  }): OperatorStamp {
    return new OperatorStamp(operator.id, operator.displayName, operator.role);
  }

  toJSON(): {
    operatorId: string;
    displayName: string;
    role: string;
  } {
    return {
      operatorId: this.operatorId.value,
      displayName: this.displayName,
      role: this.role.value,
    };
  }
}
