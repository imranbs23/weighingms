/**
 * The snapshot entities — projections of the MES's truth.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NONE OF THESE IS AN AGGREGATE, AND THAT IS THE DESIGN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A batch belongs to OrgaTEX. A recipe belongs to OrgaTEX. The components
 * belong to the recipe, which belongs to OrgaTEX. What this unit holds is a
 * **point-in-time copy** of somebody else's truth, taken through a
 * read-only seam.
 *
 * So the consistency boundary here is the SNAPSHOT: everything inside one
 * snapshot was true of the MES at one moment, and the snapshot is immutable
 * once taken. A snapshot has no invariants to enforce and no lifecycle to
 * protect — it has a **provenance** (when it was received, from where), and
 * that is what this model gives it.
 *
 * WHY THERE IS NO AGGREGATE ROOT
 * ------------------------------
 * Because this unit cannot enforce the MES's invariants: if the MES says a
 * batch is `WEIGHED` while its recipe still has five unweighed
 * components, that is OrgaTEX's inconsistency to own. And the MES will win
 * regardless, because the MES is the master.
 *
 * Reconciliation belongs to unit `002-recipe-material-management`, which
 * owns the recipe's working cache and therefore owns what it means.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  MachineRef,
  OrderRef,
  ShadeCode,
} from '../value-objects/identifiers.js';
import type { BatchWeighingStatus } from '../value-objects/batch-weighing-status.js';
import type { BatchEligibility } from '../value-objects/batch-eligibility.js';
import type { DemandedScaleClass } from '../value-objects/demanded-scale-class.js';
import type { Tolerance } from '../value-objects/tolerance.js';

/**
 * Which adapter produced a snapshot.
 *
 * It exists so that a `DEGRADED` read is **attributable**: when the
 * operator is shown a stale queue, the record says which adapter's last
 * known-good it was.
 */
export type SnapshotSource = string;

/**
 * One batch as the MES released it.
 *
 * WeighingMS owns **none** of these fields. It reads them and projects
 * them (BRD §9.2). `componentCount` is the MES's own count — not a count
 * this unit computed from a recipe it may not have fetched.
 */
export class ReleasedBatch {
  constructor(
    readonly batchId: BatchId,
    readonly orderRef: OrderRef,
    readonly machineRef: MachineRef,
    readonly fabricDescription: string,
    readonly shadeCode: ShadeCode,
    readonly componentCount: number,
    readonly weighingStatus: BatchWeighingStatus,
    readonly eligibility: BatchEligibility,
  ) {}
}

/**
 * The released queue **as last received**.
 *
 * Immutable once constructed. `receivedAt` is the moment the snapshot was
 * received, not the moment the MES generated it — because the age that
 * matters to an operator is "how long has this been on my screen".
 */
export class BatchQueueSnapshot {
  constructor(
    readonly batches: readonly ReleasedBatch[],
    readonly receivedAt: Instant,
    readonly source: SnapshotSource,
  ) {}

  /** How many batches the MES said are in the queue. */
  get count(): number {
    return this.batches.length;
  }
}

/**
 * One component of a recipe — READ-ONLY (BRD BR-04, C-01).
 *
 * `tolerance` is **nullable**, and `null` means *absent*, never *zero*. A
 * component with no tolerance is a component that cannot be confirmed; it
 * is not a component with a tolerance of zero.
 *
 * `scaleClass` is what the component **demands** — the input to unit
 * `004`'s automatic selection. It is not the class of any device.
 */
export class RecipeComponent {
  constructor(
    readonly sequence: number,
    readonly componentId: ComponentId,
    readonly dyestuffCode: DyestuffCode,
    readonly target: WeightValue,
    readonly tolerance: Tolerance | null,
    readonly scaleClass: DemandedScaleClass,
  ) {}
}

/**
 * One batch's recipe **as last received**.
 *
 * Immutable. The components are in **recipe sequence** — the order the MES
 * gave them, which is the order they must be weighed in.
 */
export class RecipeSnapshot {
  constructor(
    readonly batchId: BatchId,
    readonly shadeCode: ShadeCode,
    readonly components: readonly RecipeComponent[],
    readonly receivedAt: Instant,
    readonly source: SnapshotSource,
  ) {}

  /** How many components the MES said the recipe has. */
  get count(): number {
    return this.components.length;
  }
}
