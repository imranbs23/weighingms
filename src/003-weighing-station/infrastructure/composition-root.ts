/**
 * The composition root — where unit 003's layers are wired.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RULE IS UNIT 004's. THE PORT IS OURS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `ScaleRegistry` satisfies `ScaleSelectionPort` structurally — its
 * `selectScale` and its `canWeigh` are the rule and the gate — so the
 * binding needs no adapter class.
 *
 * A reviewer looking for a second rule will find it here: one line, one
 * port, one implementation. **The threshold stays unit `004`'s
 * configuration** (ADR-019), so this unit hard-codes no number.
 *
 * AND THE SESSION IS MUTABLE AND PERSISTED
 * -----------------------------------------
 * The session is the station's own live state, and it is persisted so the
 * work can be resumed (NFR-06, ADR-036). It is **not** a record of a
 * completed act — the `WeighingRecord` is that, and it is immutable
 * (ADR-034's rule, applied to the record).
 */
import { SelectComponent } from '../application/use-cases/select-component.js';
import { ConsumeWeightStream } from '../application/use-cases/consume-weight-stream.js';
import { EvaluateZone } from '../application/use-cases/evaluate-zone.js';
import { ConfirmWeighing } from '../application/use-cases/confirm-weighing.js';
import { ProposeCompensation } from '../application/use-cases/propose-compensation.js';
import { DecideProposal } from '../application/use-cases/decide-proposal.js';
import { EscalateOverdose } from '../application/use-cases/escalate-overdose.js';
import { AuthoriseEscalation } from '../application/use-cases/authorise-escalation.js';
import { ConfirmComponent } from '../application/use-cases/confirm-component.js';
import { CompleteBatch } from '../application/use-cases/complete-batch.js';
import type {
  ScaleSelectionPort,
  ScaleStreamPort,
  WeighingSessionRepository,
} from '../domain/ports/weighing-station-ports.js';
import type { ScaleId } from '../../004-scale-integration/domain/value-objects/scale-id.js';
import { WeightUnitConverter } from '../../004-scale-integration/domain/services/weight-unit-converter.js';
import type { WeighingRecordRepository } from '../domain/ports/weighing-record-repository.js';
import type { SurplusProposalRepository } from '../domain/ports/surplus-proposal-repository.js';
import type {
  OverrideAuthorisationPort,
  OverrideRecordRepository,
} from '../domain/ports/override-ports.js';
import type { OrgatexWriteBackPort } from '../domain/ports/orgatex-write-back-port.js';
import type { BatchFactsPort } from '../domain/ports/orgatex-write-back-port.js';
import type { Escalation } from '../domain/entities/escalation.js';
import { ToleranceZoneEvaluator } from '../domain/services/tolerance-zone-evaluator.js';
import { ZoneBoundsCache } from '../domain/services/zone-bounds-cache.js';
import { OverdoseDetector } from '../domain/services/overdose-detector.js';
import type { OverdoseOutcome } from '../domain/services/overdose-detector.js';
import { CompensationCalculator } from '../domain/services/compensation-calculator.js';
import type { WeightValue } from '../../004-scale-integration/domain/value-objects/weight-value.js';
import type { Tolerance } from '../../005-orgatex-integration/domain/value-objects/tolerance.js';
import type { ToleranceZone } from '../domain/value-objects/tolerance-zone.js';
import type { ScaleClass } from '../../004-scale-integration/domain/value-objects/scale-capability.js';
import type { RecipeWorkingCopy } from '../../002-recipe-material-management/domain/services/recipe-working-copy.js';

export interface WeighingStationModule {
  /** The selection use case. */
  readonly selectComponent: SelectComponent;
  /** The reading path. */
  readonly consumeWeightStream: ConsumeWeightStream;
  /** The zone evaluation. */
  readonly evaluateZone: EvaluateZone;
  /** The confirmation gate. */
  readonly confirmWeighing: ConfirmWeighing;
  /** The over-dose and its proposal. */
  readonly proposeCompensation: ProposeCompensation;
  /** The operator's decision on a proposal. */
  readonly decideProposal: DecideProposal;
  /** Raising the escalation. */
  readonly escalateOverdose: EscalateOverdose;
  /** The supervisor's authorisation of it. */
  readonly authoriseEscalation: AuthoriseEscalation;
  /** The one transition — record, then advance. */
  readonly confirmComponent: ConfirmComponent;
  /** The batch's completion and its summary. */
  readonly completeBatch: CompleteBatch;
  /** The escalation for a component, or `null`. */
  readonly escalationFor: (componentId: string) => Escalation | null;
  /** Hold the raised escalation, so the supervisor's call can decide it. */
  readonly rememberEscalation: (escalation: Escalation) => void;
  /**
   * The over-dose's two quantities.
   *
   * The detector is **pure**, so it is exposed on the module — the
   * controller reports what it computes and computes nothing itself.
   */
  readonly detectOverdose: (
    value: WeightValue,
    target: WeightValue,
    band: Tolerance | null,
    zone: ToleranceZone,
  ) => OverdoseOutcome;
  /** The seam the rule is read through. */
  readonly selection: ScaleSelectionPort;
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
  /** Where the weighing record is written. */
  readonly records: WeighingRecordRepository;
  /** Where the surplus proposal is recorded. */
  readonly proposals: SurplusProposalRepository;
  /** Unit 008's authorisation service — the CONSUMED, not re-implemented. */
  readonly authorisations: OverrideAuthorisationPort;
  /** Where the override record is written. */
  readonly overrides: OverrideRecordRepository;
  /**
   * Unit 005's write path — the CONSUMED, not re-implemented (ADR-041).
   *
   * Its `ConsumptionPostingService` and `BatchStatusWriteService` satisfy
   * this port **structurally**, so the composition root binds them
   * directly — with no adapter class and no second implementation of any
   * guard. Unit 005's idempotency ledger is the atomic duplicate guard,
   * and it stays unit 005's.
   */
  readonly writeBack: OrgatexWriteBackPort;
  /** The batch's facts — the MES's, read through a port. */
  readonly batchFacts: BatchFactsPort;
  /** The device's live readings. */
  readonly stream: ScaleStreamPort;
  /** The bounds — computed once per component (ADR-037). */
  readonly bounds: ZoneBoundsCache;
}

export interface BuildWeighingStationOptions {
  /**
   * The working copy — where the recipe being worked is held.
   *
   * The recipe is **read**, not copied: it is unit `002`'s fact, and this
   * unit does not hold a second copy of it (ADR-036).
   */
  readonly workingCopy: RecipeWorkingCopy;
  /** The rule and the gate — unit 004's registry. */
  readonly selection: ScaleSelectionPort;
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
  /** Where the weighing record is written. */
  readonly records: WeighingRecordRepository;
  /** Where the surplus proposal is recorded. */
  readonly proposals: SurplusProposalRepository;
  /** Unit 008's authorisation service — the CONSUMED, not re-implemented. */
  readonly authorisations: OverrideAuthorisationPort;
  /** Where the override record is written. */
  readonly overrides: OverrideRecordRepository;
  /**
   * The device's live readings.
   *
   * The session is the **subscriber** — the weight is pushed, not polled
   * (NFR-01) — and the disconnection comes through the same subscription,
   * so there is **one** detector of it in the product.
   */
  readonly stream: ScaleStreamPort;
  /**
   * Unit 005's write path — the CONSUMED, not re-implemented (ADR-041).
   *
   * Its `ConsumptionPostingService` and `BatchStatusWriteService` satisfy
   * this port **structurally**, so the composition root binds them
   * directly — with no adapter class and no second implementation of any
   * guard. Unit 005's idempotency ledger is the atomic duplicate guard,
   * and it stays unit 005's.
   */
  readonly writeBack: OrgatexWriteBackPort;
  /** The batch's facts — the MES's, read through a port. */
  readonly batchFacts: BatchFactsPort;
  /** The clock. */
  readonly clock?: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

/**
 * The current session, or `null`.
 *
 * The repository is **synchronous** — SQLite is — and the zone is evaluated
 * on every reading, so there is nothing to await.
 */
function sessionOf(
  options: BuildWeighingStationOptions,
): ReturnType<WeighingSessionRepository['current']> {
  return options.sessions.current();
}

/**
 * The bound scale's class.
 *
 * The device's fact, read from the **device registry** — the same place the
 * gate's verdict comes from. So the record's snapshotted class is the
 * device's own, not a copy built beside it.
 */
function scaleClassOf(
  options: BuildWeighingStationOptions,
  session: ReturnType<WeighingSessionRepository['current']>,
): ScaleClass | null {
  const scaleId = session?.selectedScaleId ?? null;
  if (scaleId === null) return null;

  const device = options.selection.deviceClass(scaleId);
  return device;
}

/**
 * The batch's facts — the MES's, read through a port.
 *
 * **The target machine is NOT a station fact**, and it is not hard-coded
 * — it is the MES's, and it comes from the batch the MES released. So it
 * is read through a port, and the port is **asynchronous** because the
 * MES's read is.
 */

export function buildWeighingStationModule(
  options: BuildWeighingStationOptions,
): WeighingStationModule {
  const clock = options.clock ?? (() => new Date());

  const selectComponent = new SelectComponent({
    workingCopy: options.workingCopy,
    selection: options.selection,
    sessions: options.sessions,
    clock,
    // The subscription is established when the binding happens, so the
    // session receives the device's readings from the first one.
    onScaleBound: (scaleId) => bindToScale(scaleId),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const consumeWeightStream = new ConsumeWeightStream({
    sessions: options.sessions,
    canWeigh: (scaleId) => options.selection.canWeigh(scaleId),
    // THE CONVERSION — unit 004's, and it is EXACT. The recipe's
    // components carry the unit the MES supplied (grams for the dyestuffs,
    // kilograms for the auxiliaries) while the device reports in its own
    // unit, so the reading is converted before it is compared.
    convert: (value, toUnit) => {
      try {
        return new WeightUnitConverter().convert(value, toUnit);
      } catch {
        // An unsupported unit is a REFUSAL, not a crash.
        return null;
      }
    },
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  // THE SUBSCRIPTION — the session listens to the device it is bound to.
  //
  // It is established when a component is selected, and released when the
  // binding moves. One subscription per bound scale: a second would
  // deliver the same reading twice, and the second copy would be discarded
  // as out of order.
  let unsubscribeFromScale: (() => void) | null = null;

  const bindToScale = (scaleId: ScaleId): void => {
    unsubscribeFromScale?.();
    unsubscribeFromScale = options.stream.subscribe(
      scaleId,
      (reading) => {
        void consumeWeightStream.offer(
          scaleId,
          reading.value,
          reading.stable,
          reading.sequence,
        );
      },
      (status) => {
        const session = sessionOf(options);
        if (session === null) return;
        if (status === 'DISCONNECTED') {
          session.scaleLost();
        } else {
          session.scaleRestored(scaleId);
        }
        void options.sessions.save(session);
      },
    );
  };

  const evaluator = new ToleranceZoneEvaluator();
  const bounds = new ZoneBoundsCache();

  const evaluateZone = new EvaluateZone({
    workingCopy: options.workingCopy,
    currentWeight: () => sessionOf(options)?.currentWeight ?? null,
    activeComponentId: () => sessionOf(options)?.activeComponentId ?? null,
    evaluator,
  });

  const confirmWeighing = new ConfirmWeighing({
    workingCopy: options.workingCopy,
    records: options.records,
    evaluator,
    currentWeight: () => sessionOf(options)?.currentWeight ?? null,
    activeComponentId: () => sessionOf(options)?.activeComponentId ?? null,
    selectedScaleId: () => sessionOf(options)?.selectedScaleId ?? null,
    selectedScaleClass: () => scaleClassOf(options, sessionOf(options)),
    lotNumber: () => null,
    containerId: () => null,
    sessionId: () => sessionOf(options)?.sessionId ?? '',
    canWeigh: () => {
      const scaleId = sessionOf(options)?.selectedScaleId ?? null;
      if (scaleId === null) return false;
      return options.selection.canWeigh(scaleId).allowed;
    },
    clock,
  });

  const detector = new OverdoseDetector();

  const proposeCompensation = new ProposeCompensation({
    workingCopy: options.workingCopy,
    proposals: options.proposals,
    detector,
    // THE ONE IMPLEMENTATION — the proposal and the compensability decision
    // come from the same computation (ADR-038).
    calculator: new CompensationCalculator(),
    currentWeight: () => sessionOf(options)?.currentWeight ?? null,
    activeComponentId: () => sessionOf(options)?.activeComponentId ?? null,
    currentZone: () => {
      const outcome = evaluateZone.execute();
      return outcome.kind === 'ZONED' ? outcome.zone : null;
    },
    sessionId: () => sessionOf(options)?.sessionId ?? '',
    clock,
  });

  const decideProposal = new DecideProposal({
    proposals: options.proposals,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  // THE ESCALATION — the live state of a non-compensable over-dose waiting
  // for a supervisor.
  //
  // It is held HERE rather than in the session, because it is the
  // escalation's own state and the session's state machine belongs to unit
  // 003's progression (bolt 017). The session's component and the
  // over-dose's surplus are READ from the session and the zone.
  let currentEscalation: Escalation | null = null;

  const escalateOverdose = new EscalateOverdose({
    sessionId: () => sessionOf(options)?.sessionId ?? '',
    activeComponentId: () => sessionOf(options)?.activeComponentId ?? null,
    surplusAmount: () => {
      const zone = evaluateZone.execute();
      if (zone.kind !== 'ZONED' || zone.zone !== 'OVER') return null;
      return { text: zone.value.text, unit: zone.value.unit };
    },
    // The escalation is for the NOT-compensable case — a compensable
    // surplus gets a proposal (bolt 015).
    isCompensable: () => {
      const zone = evaluateZone.execute();
      if (zone.kind !== 'ZONED' || zone.zone !== 'OVER') return true;

      const recipe = options.workingCopy.current();
      if (recipe === null) return true;

      const active = sessionOf(options)?.activeComponentId ?? null;
      const activeEntry =
        active === null
          ? undefined
          : recipe.components.find(
              (entry) => entry.componentId.value === active.value,
            );

      // THE REMAINING COMPONENTS — the ones AFTER the active one in
      // recipe sequence.
      //
      // Not "all the others": the components BEFORE the active one have
      // already been weighed, and their target cannot absorb a surplus.
      // So the remaining set is the tail of the sequence — and the LAST
      // component has none, which is the case the story names: *"no
      // remaining components (last component over-dosed) → the surplus
      // cannot be absorbed — no proposal; escalate."*
      const remaining =
        activeEntry === undefined
          ? recipe.components
          : recipe.components.filter(
              (entry) => entry.sequence > activeEntry.sequence,
            );

      const outcome = new CompensationCalculator().calculate(
        zone.value,
        remaining.map((entry) => ({
          componentId: entry.componentId.value,
          target: entry.target,
        })),
      );

      return outcome.kind === 'COMPENSABLE';
    },
    clock,
  });

  const authoriseEscalation = new AuthoriseEscalation({
    escalation: () => currentEscalation,
    // UNIT 008's service — bound directly, with no adapter and no second
    // implementation of any check (ADR-039).
    authorisations: options.authorisations,
    overrides: options.overrides,
    operatorId: () => sessionOf(options)?.operatorId ?? null,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const confirmComponent = new ConfirmComponent({
    workingCopy: options.workingCopy,
    records: options.records,
    sessions: options.sessions,
    currentWeight: () => sessionOf(options)?.currentWeight ?? null,
    selectedScaleId: () => sessionOf(options)?.selectedScaleId ?? null,
    selectedScaleClass: () => scaleClassOf(options, sessionOf(options)),
    lotNumber: () => null,
    containerId: () => null,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const completeBatch = new CompleteBatch({
    sessions: options.sessions,
    records: options.records,
    // UNIT 005's services — bound DIRECTLY, with no adapter and no second
    // implementation of any guard (ADR-041).
    writeBack: options.writeBack,
    batchFacts: options.batchFacts,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  return {
    selectComponent,
    consumeWeightStream,
    evaluateZone,
    confirmWeighing,
    proposeCompensation,
    decideProposal,
    escalateOverdose,
    authoriseEscalation,
    confirmComponent,
    completeBatch,
    detectOverdose: (value, target, band, zone) =>
      detector.detect(value, target, band, zone),
    escalationFor: (componentId: string) =>
      currentEscalation !== null &&
      currentEscalation.componentId === componentId
        ? currentEscalation
        : null,
    rememberEscalation: (escalation: Escalation) => {
      currentEscalation = escalation;
    },
    selection: options.selection,
    sessions: options.sessions,
    records: options.records,
    proposals: options.proposals,
    authorisations: options.authorisations,
    overrides: options.overrides,
    stream: options.stream,
    writeBack: options.writeBack,
    batchFacts: options.batchFacts,
    bounds,
  };
}
