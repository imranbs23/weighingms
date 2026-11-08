/**
 * Container — the master record. WeighingMS's OWN master data.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONLY MASTER DATA THE PRODUCT OWNS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD §9.3, the data-ownership table:
 *
 * > | Container master | **WeighingMS** | **Master** |
 *
 * The recipe, the tolerances and the dyestuff master are OrgaTEX's; the
 * **container master is ours**. So it is a local table rather than a seam
 * over the MES — and that is why this unit owns a table that is
 * **updatable**, unlike the three record tables it also owns.
 *
 * WHY THE MASTER IS UPDATABLE AND THE RECORDS ARE NOT
 * -------------------------------------------------
 * A container's *known* tare genuinely changes — the container is
 * re-weighed, or taken out of service — and that is a fact about the
 * **container**, not about a weighing. So the master row is updated.
 *
 * An **assignment** is a record of an **act**, and BRD DR-02 forbids
 * revising it (ADR-034, ADR-035).
 *
 * TWO TABLES, TWO MUTABILITY RULES, TWO REASONS
 * ---------------------------------------------
 * The distinction is the one the whole product turns on: **reference data
 * is maintained; the record of an act is not.**
 *
 * THE TARE IS NULLABLE HERE, AND NEVER IN AN ASSIGNMENT
 * ----------------------------------------------------
 * A container with no known tare is a container the master does not weigh —
 * and then the empty container must be **weighed** instead.
 *
 * And a tare of **zero** is not the same as no tare: unit `004` already
 * settled that (S-12), and this unit inherits it. The master holds `null`
 * for "we do not know", and `0.0000` is a real known tare.
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ContainerId } from '../value-objects/container-id.js';
import type { ContainerType } from '../value-objects/container-type.js';

export class Container {
  constructor(
    /** The vessel. */
    readonly containerId: ContainerId,
    /** What kind of vessel it is. */
    readonly containerType: ContainerType,
    /**
     * The container's **known** tare, or `null` when the master does not
     * weigh it.
     *
     * `null` means **absent** — never zero, and never "unknown".
     */
    readonly tareWeight: WeightValue | null,
    /** Is the container available for use? */
    readonly inService: boolean,
  ) {}

  /**
   * Does the master hold a tare for this container?
   *
   * The question the tare policy asks. A `null` tare means the container
   * must be **weighed empty** instead.
   */
  get hasKnownTare(): boolean {
    return this.tareWeight !== null;
  }
}
