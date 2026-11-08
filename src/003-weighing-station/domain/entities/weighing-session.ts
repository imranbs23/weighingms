/**
 * WeighingSession — the state machine. The product's pivot.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LIVE STATE OF THE WORK. MUTABLE. AND PERSISTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The unit brief calls the session *"the pivot of the whole product"*, and
 * it is literally the only thing that knows which component is being
 * weighed, on which scale, and what the scale last said.
 *
 * **It is the live state, not a record of a completed act** — so it is
 * **mutable**, and it is **persisted** so the operator can resume after an
 * interruption (NFR-06, invariant 7). The `WeighingRecord` is the *act*,
 * and it is immutable (BRD DR-02) — that is a different table, in bolt
 * `017` (ADR-036).
 *
 * THE FOUR INVARIANTS THIS BOLT ENFORCES
 * --------------------------------------
 * The unit brief lists seven. This bolt enforces four, and the other three
 * belong to later bolts:
 *
 * 1. **Exactly one** component is `ACTIVE` at a time.
 * 2. **`DONE` is terminal** — a completed component cannot be re-selected
 *    or re-weighed (BRD DR-02, C-08).
 * 3. **Selecting a component resets the weight to zero.**
 * 4. The session is in `WEIGHING` **only** when a scale is selected and a
 *    component is active.
 *
 * THE READING RULES
 * -----------------
 * Each rule rejects a reading for a **different reason**, and each
 * rejection **changes nothing** — the current weight is **retained**, not
 * zeroed. A rejected reading must not make the operator's readout say "0 g"
 * when the scale is actually reading 40 g.
 *
 *   - a **lower sequence** → out of order
 *   - a **different scale** → a late reading cannot corrupt the active
 *     component
 *   - a **different unit** → invalid; the previous valid weight is kept
 *   - **not weighing** → no component state is affected
 *
 * And `stable = false` is **surfaced**, not collapsed (BRD IR-11): the
 * operator sees that the weight is still settling.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ReadingSequence } from '../../../004-scale-integration/domain/value-objects/reading-sequence.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { SessionState } from '../value-objects/session-state.js';

/** One component's progression within the session. */
export interface ComponentProgress {
  readonly componentId: ComponentId;
  state: 'PENDING' | 'ACTIVE' | 'DONE';
}

/** Why a reading was discarded. A **closed set** of four. */
export type ReadingRejection =
  | 'OUT_OF_ORDER'
  | 'WRONG_SCALE'
  | 'WRONG_UNIT'
  | 'NOT_WEIGHING';

/** The outcome of offering a reading to the session. */
export type ReadingOutcome =
  | { readonly kind: 'ACCEPTED'; readonly weight: WeightValue }
  | { readonly kind: 'DISCARDED'; readonly reason: ReadingRejection };

/**
 * What a confirmation did to the component list.
 *
 * `COMPLETED` is **distinct** from "advanced to nothing" — the last
 * component's confirmation **completes** the batch, and that is a defined
 * outcome rather than an ambiguous one (ADR-040).
 */
export type ProgressionOutcome =
  | { readonly kind: 'ADVANCED'; readonly to: ComponentId }
  | { readonly kind: 'COMPLETED' };

/** The session's constructor arguments. */
export interface WeighingSessionInit {
  readonly sessionId: string;
  readonly batchId: BatchId;
  readonly operatorId: OperatorId;
  readonly startedAt: Instant;
  readonly components: readonly ComponentProgress[];
}

export class WeighingSession {
  readonly sessionId: string;
  readonly batchId: BatchId;
  readonly operatorId: OperatorId;
  readonly startedAt: Instant;

  /** The machine's state. */
  private currentState: SessionState = 'AWAITING_BATCH';
  /** The component being dispensed — exactly one at a time. */
  private activeComponent: ComponentId | null = null;
  /** The device the session is bound to. */
  private boundScale: ScaleId | null = null;
  /** The last accepted reading, net of the tare. */
  private weight: WeightValue | null = null;
  /** Whether the last reading was settled. */
  private settled = true;
  /**
   * Whether the weight is the last known one rather than a live reading.
   *
   * It is **true** when the scale has gone away — and the operator can
   * still see what the scale last said, marked as old (BRD IR-13).
   */
  private stale = false;
  /** The last accepted reading's sequence — the out-of-order floor. */
  private lastSequence: number | null = null;
  /** The component states, in recipe order. */
  private readonly progress: ComponentProgress[];
  /**
   * The active component's unit.
   *
   * It is the **recipe's** fact, and this unit **reads** it rather than
   * copying it (ADR-036). So it is set when a component is selected.
   */
  componentUnit: string | null = null;

  constructor(init: WeighingSessionInit) {
    this.sessionId = init.sessionId;
    this.batchId = init.batchId;
    this.operatorId = init.operatorId;
    this.startedAt = init.startedAt;
    this.progress = init.components.map((entry) => ({ ...entry }));
  }

  /** The machine's current state. */
  get state(): SessionState {
    return this.currentState;
  }

  /** The component being dispensed, or `null`. */
  get activeComponentId(): ComponentId | null {
    return this.activeComponent;
  }

  /** The bound device, or `null`. */
  get selectedScaleId(): ScaleId | null {
    return this.boundScale;
  }

  /** The last accepted reading, or `null`. */
  get currentWeight(): WeightValue | null {
    return this.weight;
  }

  /** Is the last reading settled? */
  get weightIsStable(): boolean {
    return this.settled;
  }

  /**
   * Is the weight the last known one rather than a live reading?
   *
   * It is `true` when the scale has gone away — and the last known weight
   * is **retained** for display, marked as old (BRD IR-13).
   */
  get weightIsStale(): boolean {
    return this.stale;
  }

  /** The last accepted reading's sequence, or `null`. */
  get lastAcceptedSequence(): number | null {
    return this.lastSequence;
  }

  /** The component states, in recipe order. */
  get components(): readonly ComponentProgress[] {
    return this.progress;
  }

  /** How many components are `DONE`. */
  get completedCount(): number {
    return this.progress.filter((entry) => entry.state === 'DONE').length;
  }

  /** How many components there are. */
  get componentCount(): number {
    return this.progress.length;
  }

  /**
   * Select a component, and bind the scale it is weighed on.
   *
   * The scale is **given**, not chosen — the rule has already resolved it,
   * and the operator never chooses (BRD BR-05). So this method takes the
   * answer, not a request.
   *
   * @throws When the component is unknown or already `DONE` — `DONE` is
   *         terminal (C-08).
   */
  selectComponent(componentId: ComponentId, scaleId: ScaleId): void {
    const entry = this.progress.find(
      (candidate) => candidate.componentId.value === componentId.value,
    );
    if (entry === undefined) {
      throw new Error(`The session has no component ${componentId.value}`);
    }
    if (entry.state === 'DONE') {
      throw new Error(
        `Component ${componentId.value} is DONE and cannot be re-selected`,
      );
    }

    // Exactly one component is ACTIVE at a time: the previous one goes
    // back to PENDING.
    for (const candidate of this.progress) {
      if (candidate.state === 'ACTIVE') {
        candidate.state = 'PENDING';
      }
    }
    entry.state = 'ACTIVE';

    this.activeComponent = componentId;
    this.boundScale = scaleId;

    // SELECTING A COMPONENT RESETS THE WEIGHT TO ZERO. And the sequence
    // floor is reset with it: a new component's readings are a new
    // conversation with the device, and the previous component's sequence
    // is not a floor for them.
    this.weight = null;
    this.settled = true;
    this.stale = false;
    this.lastSequence = null;

    this.currentState = 'WEIGHING';
  }

  /**
   * Offer a reading to the session.
   *
   * The rules are applied in order, and the first one that matches wins —
   * because each is a **different fact**, and the reason the reading was
   * discarded is what the operator must be told.
   */
  offerReading(
    scaleId: ScaleId,
    weight: WeightValue,
    stable: boolean,
    sequence: ReadingSequence,
  ): ReadingOutcome {
    // 1. NOT WEIGHING. Nothing is affected.
    if (this.currentState !== 'WEIGHING') {
      return { kind: 'DISCARDED', reason: 'NOT_WEIGHING' };
    }

    // 2. WRONG SCALE. A late reading from another device cannot corrupt
    //    the active component's state.
    if (this.boundScale === null || this.boundScale.value !== scaleId.value) {
      return { kind: 'DISCARDED', reason: 'WRONG_SCALE' };
    }

    // 3. WRONG UNIT. `WeightValue.compareTo` refuses to compare across
    //    units rather than converting behind the caller's back — and a
    //    reading in the wrong unit is INVALID, not convertible.
    if (this.componentUnit !== null && weight.unit !== this.componentUnit) {
      return { kind: 'DISCARDED', reason: 'WRONG_UNIT' };
    }

    // 4. OUT OF ORDER. The floor is the last ACCEPTED sequence — a
    //    discarded reading was never accepted, so it does not move it.
    if (this.lastSequence !== null && sequence.value <= this.lastSequence) {
      return { kind: 'DISCARDED', reason: 'OUT_OF_ORDER' };
    }

    // ACCEPTED. The weight, the settling distinction, and the floor.
    this.weight = weight;
    this.settled = stable;
    this.stale = false;
    this.lastSequence = sequence.value;

    return { kind: 'ACCEPTED', weight };
  }

  /**
   * The scale has gone away.
   *
   * Weighing is **blocked**, and the last known weight is **retained for
   * display and marked stale** — the operator can still see what the
   * scale last said, and the UI can mark it as old (BRD IR-13).
   */
  scaleLost(): void {
    if (this.currentState !== 'WEIGHING') return;
    this.currentState = 'AWAITING_COMPONENT';
    this.boundScale = null;
    this.stale = this.weight !== null;
  }

  /**
   * The scale came back.
   *
   * The stream resumes and the current weight is re-established **without
   * an operator action** (the story's edge case).
   */
  scaleRestored(scaleId: ScaleId): void {
    if (this.currentState !== 'AWAITING_COMPONENT') return;
    if (this.activeComponent === null) return;
    this.boundScale = scaleId;
    this.currentState = 'WEIGHING';
    // The weight is NOT cleared — it is marked stale until a live reading
    // arrives, so the operator never sees a zero that the scale did not
    // report.
    this.stale = this.weight !== null;
  }

  /**
   * Confirm the active component and advance to the next.
   *
   * ══════════════════════════════════════════════════════════════════════
   * ONE TRANSITION. THE RECORD IS WRITTEN BEFORE IT IS CALLED.
   * ══════════════════════════════════════════════════════════════════════
   *
   * The story is explicit: *"the confirmed component's `DONE` state and the
   * next component's activation happen in one atomic transition with the
   * record write, so a crash cannot leave two `ACTIVE` components or a
   * `DONE` component with no record."*
   *
   * **The caller writes the record FIRST** — so a confirmed weighing is
   * durable before the response is returned (BRD NFR-05) — and **then**
   * calls this. A crash between the two leaves the component `ACTIVE` and
   * unwritten, so the operator re-confirms and the duplicate is refused.
   * The reverse order would lose a confirmed weighing silently, and a
   * missing record for a weighing that happened is exactly the failure
   * BRD BR-14 and DR-01 exist to prevent (ADR-040).
   *
   * @param componentId The component being confirmed — it must be the
   *   session's **active** one.
   * @param recipeOrder The components in **recipe order** — the MES's order,
   *   read-only and never modified (C-01).
   * @returns What the transition did.
   */
  confirm(
    componentId: ComponentId,
    recipeOrder: readonly { readonly componentId: ComponentId }[],
  ): ProgressionOutcome {
    if (this.activeComponent === null) {
      throw new Error('No component is active, so none can be confirmed');
    }

    // `DONE` IS TERMINAL. A completed component cannot be confirmed
    // again (C-08, invariant 2).
    //
    // And the check comes FIRST — before the active-component check —
    // because `DONE` is the more specific fact. A `DONE` component is
    // never the active one, so checking the active component first would
    // report the wrong reason: "not the active component" rather than
    // "already done". And the second is the one the operator needs.
    const entry = this.progress.find(
      (candidate) => candidate.componentId.value === componentId.value,
    );
    if (entry === undefined) {
      throw new Error(`The session has no component ${componentId.value}`);
    }
    if (entry.state === 'DONE') {
      throw new Error(
        `Component ${componentId.value} is DONE and cannot be confirmed again`,
      );
    }

    if (this.activeComponent.value !== componentId.value) {
      throw new Error(
        `Component ${componentId.value} is not the active component`,
      );
    }

    // THE CONFIRMED COMPONENT BECOMES `DONE`.
    entry.state = 'DONE';
    this.activeComponent = null;
    this.boundScale = null;
    this.weight = null;
    this.settled = true;
    this.stale = false;
    this.lastSequence = null;

    // THE NEXT `PENDING` COMPONENT IN RECIPE ORDER BECOMES `ACTIVE`.
    //
    // The order is the MES's, and it is read-only — so the recipe is read
    // and never written (C-01). And the next is the first `PENDING` that
    // comes **after** the confirmed one — the components before it have
    // already been weighed and cannot absorb anything (ADR-040).
    const confirmedIndex = recipeOrder.findIndex(
      (candidate) => candidate.componentId.value === componentId.value,
    );

    const next = recipeOrder.find((candidate, index) => {
      if (confirmedIndex >= 0 && index <= confirmedIndex) return false;
      const candidateEntry = this.progress.find(
        (progress) =>
          progress.componentId.value === candidate.componentId.value,
      );
      return candidateEntry !== undefined && candidateEntry.state === 'PENDING';
    });

    if (next === undefined) {
      // NO NEXT COMPONENT. The last component was confirmed.
      this.currentState = 'COMPLETE';
      return { kind: 'COMPLETED' };
    }

    const nextEntry = this.progress.find(
      (progress) => progress.componentId.value === next.componentId.value,
    );
    if (nextEntry === undefined) {
      this.currentState = 'COMPLETE';
      return { kind: 'COMPLETED' };
    }

    nextEntry.state = 'ACTIVE';
    this.activeComponent = next.componentId;
    this.currentState = 'AWAITING_COMPONENT';

    return { kind: 'ADVANCED', to: next.componentId };
  }

  /**
   * Restore the session's live state — after a restart.
   *
   * The session is persisted so the work can be **resumed** (NFR-06), and
   * this is how it comes back. It restores the **live** facts only: the
   * state, the active component, the bound scale, the weight, whether it is
   * stable, whether it is stale, and the sequence floor.
   *
   * **The sequence floor is restored too** — and that is the point. A
   * reading replayed after a restart is still rejected, because the floor
   * survived the process (ADR-036).
   */
  restore(state: {
    readonly state: SessionState;
    readonly activeComponentId: ComponentId | null;
    readonly selectedScaleId: ScaleId | null;
    readonly currentWeight: WeightValue | null;
    readonly stable: boolean;
    readonly stale: boolean;
    readonly sequence: number | null;
    /** The component's unit — persisted, because the reading is converted into it. */
    readonly componentUnit?: string | null;
  }): void {
    this.currentState = state.state;
    this.activeComponent = state.activeComponentId;
    this.boundScale = state.selectedScaleId;
    this.weight = state.currentWeight;
    this.settled = state.stable;
    this.stale = state.stale;
    this.lastSequence = state.sequence;
    if (state.componentUnit !== undefined) {
      this.componentUnit = state.componentUnit;
    }
  }
}
