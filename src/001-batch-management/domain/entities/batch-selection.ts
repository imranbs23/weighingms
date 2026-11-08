/**
 * BatchSelection — the operator's chosen batch, as a recorded act.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 08:14:22, operator OP-001 chose batch B-24187 by scanning its
 * card"* is a fact about something that physically happened. BRD DR-02
 * requires that such a record not be edited — and corrections are new
 * records.
 *
 * WHY IT CARRIES THE ORDER AND THE MACHINE
 * ---------------------------------------
 * The crumb shows batch, order and machine (BRD FR-34). If the selection
 * carried only the batch id, the crumb would have to be re-derived from a
 * queue read at render time — and the queue might have changed, been
 * filtered away, or be unreachable. The operator would then see a crumb
 * that disagrees with the selection they made.
 *
 * So three identifiers are copied. **Nothing else is**: the recipe, the
 * status and the counts are other units' facts and change under other
 * rules.
 *
 * WHY IT IS NOT THE WEIGHING SESSION
 * ----------------------------------
 * CQ-03 asks whether a batch can be split across shifts or operators. If
 * it can, then "selecting a batch" is not "starting a batch", and a
 * selection may be *resumed* rather than created. This unit **stores** the
 * selection; unit `003-weighing-station` owns the session and the resume
 * decision.
 *
 * So the record carries enough to be resumed — batch, operator, time,
 * method — and nothing that would let it *be* the session. In particular
 * it carries **no scale, no weight, no tolerance and no component state**,
 * because those belong to units 003 and 002.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { BatchId, MachineRef, OrderRef } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { SelectionMethod } from '../value-objects/selection-method.js';

export class BatchSelection {
  constructor(
    /** Which batch was chosen. */
    readonly batchId: BatchId,
    /** The order, as the operator saw it when they chose. */
    readonly orderRef: OrderRef,
    /** The machine, as the operator saw it when they chose. */
    readonly machineRef: MachineRef,
    /** Who chose it — from the session, never from a request body. */
    readonly operatorId: OperatorId,
    /** **When the act happened.** */
    readonly selectedAt: Instant,
    /** How the operator chose it. */
    readonly selectionMethod: SelectionMethod,
  ) {}
}
