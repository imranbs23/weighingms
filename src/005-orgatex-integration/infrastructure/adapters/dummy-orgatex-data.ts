/**
 * The Dummy OrgaTEX's world — the seed data behind the training MES.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A TRAINING ARTEFACT, NOT A CLAIM ABOUT THE REAL MES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The batches and the recipe come from the supplied prototype
 * (`docs/customize-weighing-station.html`). The prototype's own queue is
 * four batches and its recipe is five components, and those are what this
 * world holds.
 *
 * The world is **mutable and coherent**: a batch's weighing status can
 * advance, a recipe can be revised, and the accumulated consumption
 * grows. That is what makes the Dummy a real development artefact rather
 * than a fixture — the same UI can be driven through a normal weighing, a
 * rejection, and an outage, and the state carries across those.
 *
 * THE SHAPE IS THE MES'S SHAPE
 * ----------------------------
 * The field names below are the **Dummy MES's** field names, not the
 * product's. The product's endpoints expose domain snapshots; this world
 * speaks in raw records. That separation is what keeps the seam real — if
 * the product's API mirrored this, replacing the Dummy with the real MES
 * would mean changing every consumer (ADR-022).
 *
 * EVERY QUANTITY IS A STRING
 * --------------------------
 * `"1240.0000"` and never `1240`. A JSON number decodes to an IEEE-754
 * double in every parser, and the tolerance boundary is where that error
 * would bite (ADR-008, BRD NFR-16). The Dummy MES is honest about the
 * rule, so the training world never teaches the wrong thing.
 */
import type {
  RawBatch,
  RawComponent,
  RawConsumption,
  RawQueue,
  RawRecipe,
} from '../../domain/ports/orgatex-adapter.js';

/** One batch in the Dummy world. */
interface WorldBatch extends RawBatch {
  /** The MES's own recipe for this batch. */
  readonly recipe: RawRecipe;
}

/**
 * The four prototype batches.
 *
 * The statuses are the prototype's own: `B-24187` is `WEIGHING` (the row
 * the prototype marks as selected) and the other three are `QUEUED`.
 *
 * Note that **none of them is `RELEASED`** — which means the queue the
 * prototype shows contains no selectable batch by this seam's own
 * eligibility rule. That is deliberate and correct: the prototype's
 * selection is a display choice, and `B-24187` is `WEIGHING` because
 * another station is working it. A station that starts here must be given
 * a released batch before it can weigh one — which is exactly what the
 * rule is for.
 */
const SEED_BATCHES: readonly WorldBatch[] = [
  {
    batchId: 'B-24187',
    orderRef: 'SO-9931',
    machineRef: 'JET-04',
    fabricDescription: '100% CTN knit · 480 kg',
    shadeCode: 'Teal 4C',
    componentCount: 5,
    weighingStatus: 'WEIGHING',
    recipe: {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        {
          sequence: 1,
          componentId: 'DYE-4471-B',
          dyestuffCode: 'DYE-1180',
          target: '1240.0000',
          unit: 'g',
          toleranceMin: '1234.0000',
          toleranceMax: '1246.0000',
          scaleClass: 'PRECISION',
          name: 'Remazol Brill. Blue RSPL',
          swatchColour: '#1f4fa8',
        },
        {
          sequence: 2,
          componentId: 'DYE-2204-R',
          dyestuffCode: 'DYE-2204',
          target: '386.0000',
          unit: 'g',
          toleranceMin: '384.0000',
          toleranceMax: '388.0000',
          scaleClass: 'PRECISION',
          name: 'Remazol Red RB',
          swatchColour: '#b8253a',
        },
        {
          sequence: 3,
          componentId: 'DYE-4471-Y',
          dyestuffCode: 'DYE-4471',
          target: '94.0000',
          unit: 'g',
          toleranceMin: '93.5000',
          toleranceMax: '94.5000',
          scaleClass: 'PRECISION',
          name: 'Remazol Yellow RGB',
          swatchColour: '#d9a520',
        },
        {
          sequence: 4,
          componentId: 'AUX-0101',
          dyestuffCode: 'AUX-0101',
          target: '24.0000',
          unit: 'kg',
          toleranceMin: '23.8800',
          toleranceMax: '24.1200',
          scaleClass: 'FLOOR',
          name: 'Sodium Sulphate',
          swatchColour: '#c9d2dc',
        },
        {
          sequence: 5,
          componentId: 'AUX-0107',
          dyestuffCode: 'AUX-0107',
          target: '9.6000',
          unit: 'kg',
          toleranceMin: '9.5520',
          toleranceMax: '9.6480',
          scaleClass: 'FLOOR',
          name: 'Soda Ash',
          swatchColour: '#e4eaf0',
        },
      ],
    },
  },
  {
    batchId: 'B-24188',
    orderRef: 'SO-9931',
    machineRef: 'JET-07',
    fabricDescription: '100% CTN knit · 520 kg',
    shadeCode: 'Teal 4C',
    componentCount: 5,
    weighingStatus: 'QUEUED',
    recipe: {
      batchId: 'B-24188',
      shadeCode: 'Teal 4C',
      components: [],
    },
  },
  {
    batchId: 'B-24190',
    orderRef: 'SO-9944',
    machineRef: 'JET-02',
    fabricDescription: 'CVC fleece · 310 kg',
    shadeCode: 'Navy 12',
    componentCount: 7,
    weighingStatus: 'QUEUED',
    recipe: {
      batchId: 'B-24190',
      shadeCode: 'Navy 12',
      components: [],
    },
  },
  {
    batchId: 'B-24191',
    orderRef: 'SO-9947',
    machineRef: 'WINCH-01',
    fabricDescription: 'Viscose jersey · 190 kg',
    shadeCode: 'Rose 08',
    componentCount: 4,
    weighingStatus: 'QUEUED',
    recipe: {
      batchId: 'B-24191',
      shadeCode: 'Rose 08',
      components: [],
    },
  },
];

/**
 * The Dummy OrgaTEX's mutable world.
 *
 * The adapter and the Dummy MES's HTTP router share **one instance** of
 * this, so a batch added through the router is immediately visible to the
 * adapter and vice versa. That is what makes the training artefact
 * coherent rather than decorative — and it is why the two cannot drift:
 * there is only one copy to be wrong (ADR-022).
 */
export class DummyOrgatexWorld {
  private readonly batches = new Map<string, WorldBatch>();

  /**
   * The lots the MES holds, keyed by `batchId` then `componentId`.
   *
   * The MES owns the lot (BRD §9.3 — *"Dyestuff lot: OrgaTEX if
   * available, else WeighingMS"*). So it lives here, in the MES's world,
   * and a component with **no** entry is a component the MES holds no lot
   * for — which is the normal case for the station's scan and keyed-in
   * paths.
   */
  private readonly lots = new Map<string, Map<string, string>>();

  /**
   * Whether the MES is reachable.
   *
   * The outage switch. It is what makes FR-20 demonstrable in the running
   * product rather than only in a test — the same reason the scale unit
   * has a link control.
   */
  private reachable = true;

  /** The consumption the MES has accumulated, per batch. */
  private readonly consumption = new Map<string, readonly RawComponent[]>();

  /**
   * Every posting the MES received, per batch, AS RECEIVED (bolt 033) —
   * lot, operator, weighing time and idempotency key included, so the
   * write-back's result can be read back. Not deduplicated: a duplicate
   * stays visible.
   */
  private readonly postings = new Map<string, readonly RawConsumption[]>();

  /**
   * Whether the MES refuses consumptions.
   *
   * The **rejection** control, as distinct from the outage control. The
   * difference matters: an outage is an `UNREACHABLE` failure, which
   * leaves the posting `QUEUED`, while a refusal is a **definitive**
   * answer that advances the posting's state to `REJECTED` and retains
   * the reason.
   *
   * Two different outcomes, two different controls, so a training run can
   * demonstrate each on its own.
   */
  private refusingConsumptions = false;

  /** Whether the MES refuses status writes. */
  private refusingStatusWrites = false;

  constructor(seed: readonly WorldBatch[] = SEED_BATCHES) {
    for (const batch of seed) {
      this.batches.set(batch.batchId, batch);
    }

    // The MES's own lots — the prototype's (Rule 5). Only SOME components
    // have one, because that is the interesting case: a component the MES
    // holds a lot for is captured as `SOURCE`, and one it does not is the
    // operator's scan or keyed-in path.
    this.setLot('B-24187', 'DYE-4471-B', '2026-0341');
    this.setLot('B-24187', 'DYE-2204-R', '2026-0298');
    this.setLot('B-24187', 'DYE-4471-Y', '2026-0387');
  }

  /** Is the MES refusing consumptions right now? */
  get rejectsConsumption(): boolean {
    return this.refusingConsumptions;
  }

  /** Is the MES refusing status writes right now? */
  get rejectsStatusWrite(): boolean {
    return this.refusingStatusWrites;
  }

  /**
   * Make the MES refuse consumptions, or accept them again.
   *
   * @returns the previous state, so a caller can restore it.
   */
  setRejectsConsumption(refuses: boolean): boolean {
    const previous = this.refusingConsumptions;
    this.refusingConsumptions = refuses;
    return previous;
  }

  /**
   * Make the MES refuse status writes, or accept them again.
   *
   * @returns the previous state, so a caller can restore it.
   */
  setRejectsStatusWrite(refuses: boolean): boolean {
    const previous = this.refusingStatusWrites;
    this.refusingStatusWrites = refuses;
    return previous;
  }

  /** Is the MES reachable right now? */
  get isReachable(): boolean {
    return this.reachable;
  }

  /**
   * Make the MES unreachable, or reachable again.
   *
   * @returns the previous state, so a caller can restore it.
   */
  setReachable(reachable: boolean): boolean {
    const previous = this.reachable;
    this.reachable = reachable;
    return previous;
  }

  /**
   * The queue, filtered by status when a filter is given.
   *
   * The MES applies the filter itself — and the reader applies it AGAIN on
   * the result, because the seam does not assume the MES honoured it.
   */
  readQueue(filter?: string): RawQueue {
    const batches = [...this.batches.values()].filter(
      (batch) => filter === undefined || batch.weighingStatus === filter,
    );

    return {
      batches: batches.map((batch) => ({
        batchId: batch.batchId,
        orderRef: batch.orderRef,
        machineRef: batch.machineRef,
        fabricDescription: batch.fabricDescription,
        shadeCode: batch.shadeCode,
        componentCount: batch.componentCount,
        weighingStatus: batch.weighingStatus,
      })),
    };
  }

  /** A batch's recipe, or null when the MES has no such batch. */
  readRecipe(batchId: string): RawRecipe | null {
    const batch = this.batches.get(batchId);
    if (batch === undefined) return null;

    return {
      batchId: batch.batchId,
      shadeCode: batch.shadeCode,
      components: batch.recipe.components,
    };
  }

  /** A batch, or null when the MES has no such batch. */
  readBatch(batchId: string): RawBatch | null {
    const batch = this.batches.get(batchId);
    if (batch === undefined) return null;

    return {
      batchId: batch.batchId,
      orderRef: batch.orderRef,
      machineRef: batch.machineRef,
      fabricDescription: batch.fabricDescription,
      shadeCode: batch.shadeCode,
      componentCount: batch.componentCount,
      weighingStatus: batch.weighingStatus,
    };
  }

  /**
   * Advance a batch's weighing status.
   *
   * The MES owns this field, and bolt `006` is what writes it. The world
   * exposes it so the training artefact can be driven — the same way the
   * prototype's own data can be.
   */
  setWeighingStatus(batchId: string, status: string): boolean {
    const batch = this.batches.get(batchId);
    if (batch === undefined) return false;

    this.batches.set(batchId, { ...batch, weighingStatus: status });
    return true;
  }

  /**
   * Replace a batch's recipe — the MES revising it under the station.
   *
   * The newer recipe supersedes the older one, and a weighing that already
   * happened is not altered: targets are snapshotted onto the weighing
   * record at weighing time (BRD BR-14).
   */
  setRecipe(batchId: string, recipe: RawRecipe): boolean {
    const batch = this.batches.get(batchId);
    if (batch === undefined) return false;

    this.batches.set(batchId, { ...batch, recipe });
    return true;
  }

  /**
   * The lot the MES holds for a component, or `null` when it holds none.
   */
  readLot(batchId: string, componentId: string): string | null {
    const forBatch = this.lots.get(batchId);
    if (forBatch === undefined) return null;
    return forBatch.get(componentId) ?? null;
  }

  /**
   * Set (or clear) the lot the MES holds for a component.
   *
   * A test drives the three routes through this: a lot here is captured as
   * `SOURCE`; no lot here means the operator's scan or keyed-in path
   * applies.
   */
  setLot(batchId: string, componentId: string, lotNumber: string | null): boolean {
    if (!this.batches.has(batchId)) return false;

    let forBatch = this.lots.get(batchId);
    if (forBatch === undefined) {
      forBatch = new Map<string, string>();
      this.lots.set(batchId, forBatch);
    }

    if (lotNumber === null) {
      forBatch.delete(componentId);
    } else {
      forBatch.set(componentId, lotNumber);
    }
    return true;
  }

  /** The consumption accumulated against a batch. */
  readConsumption(batchId: string): readonly RawComponent[] {
    return this.consumption.get(batchId) ?? [];
  }

  /** Every posting received for a batch, as received, in arrival order. */
  readPostings(batchId: string): readonly RawConsumption[] {
    return this.postings.get(batchId) ?? [];
  }

  /** Record consumption against a batch. */
  addConsumption(batchId: string, components: readonly RawComponent[]): void {
    const existing = this.consumption.get(batchId) ?? [];
    this.consumption.set(batchId, [...existing, ...components]);
  }

  /**
   * Post one consumption.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE DUMMY MES DOES NOT DEDUPLICATE. AND THAT IS THE POINT.
   * ══════════════════════════════════════════════════════════════════
   *
   * ADR-025 says the guarantee is **local**: the station's ledger is
   * what stops a second copy leaving the machine. The key is carried on
   * the request because the MES *may* deduplicate — but no claim is made
   * that it does (Q-02).
   *
   * So this world **accepts every consumption it is given**, key or no
   * key. If the local guard ever failed, the Dummy would show the double
   * posting plainly, which is exactly what a training artefact is for.
   *
   * A world that deduplicated would hide the failure this bolt exists to
   * prevent.
   */
  postConsumption(consumption: RawConsumption): void {
    this.postings.set(consumption.batchId, [
      ...(this.postings.get(consumption.batchId) ?? []),
      { ...consumption },
    ]);
    this.addConsumption(consumption.batchId, [
      {
        sequence: 0,
        componentId: consumption.componentId,
        dyestuffCode: consumption.componentId,
        target: consumption.actualQuantity,
        unit: consumption.unit,
        toleranceMin: null,
        toleranceMax: null,
        scaleClass: 'PRECISION',
        // The MES's consumption echo carries no display facts — the
        // material's name and colour live on the master, not on a
        // consumption record (ADR-032).
      },
    ]);
  }

  /**
   * Advance a batch's weighing status.
   *
   * Only the weighing status may be changed — the method takes a status,
   * not a batch, so there is no parameter through which another OrgaTEX
   * batch field could be altered (BRD IR-06, C-01).
   */
  writeBatchStatus(batchId: string, status: string): boolean {
    return this.setWeighingStatus(batchId, status);
  }
}

/** The seed batches, exported so a test can assert against them. */
export const DUMMY_ORGATEX_BATCH_IDS: readonly string[] = SEED_BATCHES.map(
  (batch) => batch.batchId,
);
