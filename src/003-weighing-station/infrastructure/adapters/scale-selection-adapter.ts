/**
 * ScaleSelectionAdapter — the rule, bound to unit 004's registry.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SHIM. THE RULE IS UNIT 004's, AND IT IS NOT RE-IMPLEMENTED HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `004`'s `ScaleSelectionRule` already answers the question, already
 * with a **discriminated union** (ADR-018) and already with the threshold
 * as **configuration** (ADR-019). So this adapter is a shim over the
 * registry — and **unit `004` is not changed by bolt 013**. The port is the
 * boundary.
 *
 * AND THE GATE IS THE REGISTRY'S TOO
 * ---------------------------------
 * `ScaleRegistry.canWeigh` is the **single chokepoint** for "may this
 * device be weighed on" (S-7) — expired calibration, disconnected, or
 * unknown. So the gate is consulted through the registry, and a scale
 * whose calibration has expired is refused at selection (BRD FR-12,
 * BRD BR-24, AC-14).
 */
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import { ComponentId } from '../../../004-scale-integration/domain/value-objects/component-id.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleSelectionOutcome } from '../../../004-scale-integration/domain/value-objects/scale-selection-outcome.js';
import type { ScaleClass } from '../../../004-scale-integration/domain/value-objects/scale-capability.js';
import type { ScaleRegistry } from '../../../004-scale-integration/domain/services/scale-registry.js';
import type { WeighingVerdict } from '../../../004-scale-integration/domain/services/scale-health-policy.js';
import type { ScaleSelectionPort } from '../../domain/ports/weighing-station-ports.js';

export class ScaleSelectionAdapter implements ScaleSelectionPort {
  constructor(private readonly registry: ScaleRegistry) {}

  /**
   * Resolve the scale for a component's target.
   *
   * The rule needs a **component id** — it records the selection against
   * one — and this port does not carry one, because the caller already
   * knows the component. So the id is supplied by the caller through the
   * optional argument, and the rule's own record is unaffected by which
   * component the session is working on.
   */
  async select(
    target: WeightValue,
    demandedClass: ScaleClass,
    componentId: string,
  ): Promise<ScaleSelectionOutcome> {
    // The rule records the selection against a component id, and the
    // caller already knows the component — so it is passed through. The
    // id is a `ComponentId`, which is unit 004's type; the adapter builds
    // it rather than casting, so a malformed id is refused here rather
    // than reaching the rule.
    const id = ComponentId.create(componentId);

    return this.registry.selectScale(id, target, demandedClass);
  }

  /**
   * Prepare a device for weighing, and say whether it may.
   *
   * The device is **proved present** first: the registry is asked for one
   * reading, which is ingested through the normal path and brings the link
   * up. A gate consulted against a device that has never spoken answers
   * about a device nobody has heard from — and the device's link starts
   * `UNKNOWN`, so the gate would refuse every freshly registered scale.
   *
   * This is the same order unit `004`'s tare flow uses, and for the same
   * reason.
   */
  async bindScale(scaleId: ScaleId): Promise<WeighingVerdict> {
    this.registry.provePresent(scaleId);
    return this.registry.canWeigh(scaleId);
  }

  /**
   * May this device weigh **right now**?
   *
   * The registry's **single chokepoint** (S-7) — the same gate the tare
   * consults and the same gate the weighing consults. One vocabulary.
   */
  canWeigh(scaleId: ScaleId): WeighingVerdict {
    return this.registry.canWeigh(scaleId);
  }

  /**
   * The device's class — the **device's** fact.
   *
   * The weighing record snapshots it, so a later reselection cannot
   * alter what the weighing was measured on (BRD FR-25, BRD BR-14).
   */
  deviceClass(scaleId: ScaleId): ScaleClass | null {
    return this.registry.get(scaleId)?.capability.scaleClass ?? null;
  }
}
