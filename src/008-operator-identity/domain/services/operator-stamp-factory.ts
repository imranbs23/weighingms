/**
 * OperatorStampFactory — the single place an identity snapshot is taken.
 *
 * Units 003 (weighing record) and 006 (audit entry) read the stamp this
 * produces. They never re-derive it. Because the stamp is taken ONCE, at
 * the moment of the action, a later rename or role change cannot rewrite
 * history (BRD DR-02).
 */
import type { Operator } from '../entities/operator.js';
import { OperatorStamp } from '../value-objects/operator-stamp.js';

export class OperatorStampFactory {
  fromOperator(operator: Operator): OperatorStamp {
    return OperatorStamp.fromOperator(operator);
  }
}
