/**
 * WeighScreen — the prototype's "2 · Weigh".
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT RENDERS. IT NEVER DECIDES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The zone comes from the API. The quantity is the API's. The unit is the
 * API's. And the client converts **nothing** — it formats.
 *
 * WHICH COMPONENT IS ACTIVE is the station's (FR-14): the session names it,
 * and after a confirm the station advances and binds the next scale. The
 * client re-reads and renders. WHEN THE BATCH IS COMPLETE is the station's
 * too: the confirm's answer says so, and only then is the batch completed
 * (the OrgaTEX write-back) and the completion view shown (bolt 029).
 *
 * The rail is the RECIPE's components — names, codes, targets — with each
 * one's state from the session, so it is complete from the first render.
 *
 * THE TRAINING BAR — "Simulate dispense / overshoot", the prototype's own
 * controls — is shown only while the bound scale is the training dummy.
 */
import { useEffect, useRef, useState } from 'react';
import {
  acceptSurplus,
  authoriseEscalation,
  confirmComponent,
  declineSurplus,
  fetchContainer,
  fetchLot,
  fetchRecipe,
  fetchScales,
  fetchSession,
  fetchZone,
  proposeSurplus,
  raiseEscalation,
  reTare,
  selectComponent,
  trainingDispense,
  type EscalationReport,
  type RecipeComponentReport,
  type ScaleReport,
  type SessionSnapshot,
  type SurplusProposal,
} from '../../api/endpoints.js';
import { useStrings } from '../../i18n/useStrings.js';
import { useWeightStream } from '../../stream/use-weight-stream.js';
import {
  displayableReading,
  streamAge,
  useWeighStore,
} from '../../state/weigh-store.js';
import { useActionStore } from '../../state/action-store.js';
import { useWorkflowStore } from '../../state/workflow-store.js';
import {
  LiveReadout,
  RecipeRail,
  StatusLine,
  ToleranceBand,
  WeighHead,
  type RailComponent,
} from './components.js';
import { ActionRow } from './ActionRow.js';
import { SurplusPanel } from './SurplusPanel.js';
import { EscalationPanel } from './EscalationPanel.js';
import { MIN_LABEL_PX, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

/** Every locale key the weigh view uses. */
export const WEIGH_KEYS = [
  'weigh.title',
  'weigh.rail.label',
  'weigh.rail.noShade',
  'weigh.rail.weighed',
  'weigh.rail.state.active',
  'weigh.rail.state.pending',
  'weigh.rail.state.done',
  'weigh.head.noName',
  'weigh.head.scaleSelected',
  'weigh.readout.noValue',
  'weigh.readout.weighedNow',
  'weigh.readout.stillToWeigh',
  'weigh.readout.target',
  'weigh.band.label',
  'weigh.band.scaleCapacity',
  'weigh.status.unknown',
  'weigh.status.settling',
  'weigh.status.remaining',
  'weigh.zone.ok',
  'weigh.zone.near',
  'weigh.zone.over',
  'weigh.zone.under',
  'weigh.confirm.caption',
  'weigh.confirm.ok',
  'weigh.confirm.short',
  'weigh.confirm.near',
  'weigh.confirm.over',
  'weigh.confirm.under',
  'weigh.confirm.disconnected',
  'weigh.confirm.calibration',
  'weigh.confirm.overrideRequired',
  'weigh.confirm.unreachable',
  'weigh.confirm.noComponent',
  'weigh.confirm.refused',
  'weigh.retare.caption',
  'weigh.retare.refused',
  'weigh.abandon.caption',
  'weigh.training.label',
  'weigh.training.dispense',
  'weigh.training.overshoot',
  'weigh.training.refused',
  'weigh.surplus.heading',
  'weigh.surplus.amount',
  'weigh.surplus.percent',
  'weigh.surplus.factor',
  'weigh.surplus.component',
  'weigh.surplus.originalTarget',
  'weigh.surplus.revisedTarget',
  'weigh.surplus.footnote',
  'weigh.surplus.accept',
  'weigh.surplus.decline',
  'weigh.escalation.heading',
  'weigh.escalation.amount',
  'weigh.escalation.reasonRequired',
  'weigh.escalation.awaitingSupervisor',
  'weigh.escalation.authorisationId',
  'weigh.escalation.supervisorId',
  'weigh.escalation.secret',
  'weigh.escalation.reason',
  'weigh.escalation.authorise',
  'weigh.escalation.discard',
  'weigh.escalation.refused',
  'weigh.escalation.notEscalatable',
  'workflow.refusal.notComplete',
] as const;

/**
 * How often the zone is re-read — it changes at the speed the operator
 * dispenses, not at the speed the scale samples.
 */
export const ZONE_REFRESH_MS = 250;

interface ZoneView {
  readonly zone: string;
  readonly value: string;
  readonly unit: string;
  readonly target: string;
  readonly bounds: {
    readonly nearThreshold: string;
    readonly okLower: string;
    readonly okUpper: string;
  } | null;
  readonly stillToWeigh: string;
}

interface RecipeView {
  readonly batchId: string;
  readonly shadeCode: string;
  readonly components: readonly RecipeComponentReport[];
}

export function WeighScreen({
  batchId = null,
}: {
  /** The batch being weighed — the workflow's; the session's otherwise. */
  readonly batchId?: string | null;
} = {}): React.JSX.Element {
  const t = useStrings(WEIGH_KEYS);

  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [zone, setZone] = useState<ZoneView | null>(null);
  const [proposal, setProposal] = useState<SurplusProposal | null>(null);
  const [escalation, setEscalation] = useState<EscalationReport | null>(null);
  const [awaitingSupervisor, setAwaitingSupervisor] = useState(false);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [lot, setLot] = useState<{ lotNumber: string } | null>(null);
  const [container, setContainer] = useState<{ containerId: string } | null>(
    null,
  );
  const [scales, setScales] = useState<readonly ScaleReport[]>([]);

  const confirm = useActionStore((s) => s.confirm);
  const setZoneAction = useActionStore((s) => s.setZone);
  const setProposalState = useActionStore((s) => s.setProposal);
  const setEscalationState = useActionStore((s) => s.setEscalation);
  const busy = useActionStore((s) => s.busy);
  const failure = useActionStore((s) => s.failure);
  const begin = useActionStore((s) => s.begin);
  const end = useActionStore((s) => s.end);
  const fail = useActionStore((s) => s.fail);

  const completeBatch = useWorkflowStore((s) => s.complete);
  const quit = useWorkflowStore((s) => s.quit);
  const workflowRefusal = useWorkflowStore((s) => s.refusal);

  const reading = useWeighStore((s) => s.reading);
  const receivedAt = useWeighStore((s) => s.receivedAt);
  const linkState = useWeighStore((s) => s.linkState);

  // THE STREAM — opened against the scale the SESSION is bound to.
  const scaleId = session?.selectedScaleId ?? null;
  useWeightStream(scaleId);

  // The awaiting flag is read inside the polling closure, so it is kept in
  // a ref as well — the interval was created with the first render's value.
  const awaitingRef = useRef(awaitingSupervisor);
  awaitingRef.current = awaitingSupervisor;

  const reload = async (): Promise<void> => {
    const [sessionResult, zoneResult] = await Promise.all([
      fetchSession(),
      fetchZone(),
    ]);

    if (sessionResult.kind !== 'OK') {
      setZoneAction(null, { unreachable: true });
      return;
    }

    setSession(sessionResult.body.session);

    if (zoneResult.kind === 'OK') {
      setZone(
        zoneResult.body.zone === null
          ? null
          : {
              zone: zoneResult.body.zone,
              value: zoneResult.body.value ?? '',
              unit: zoneResult.body.unit ?? '',
              target: zoneResult.body.target ?? '',
              bounds: zoneResult.body.bounds ?? null,
              stillToWeigh: zoneResult.body.stillToWeigh ?? '',
            },
      );
    }

    // THE CONFIRM'S REASON — derived from the API's zone, never the
    // client's.
    const active = sessionResult.body.session?.activeComponentId ?? null;
    setZoneAction(zoneResult.kind === 'OK' ? zoneResult.body.zone : null, {
      noComponent: active === null,
      unreachable: zoneResult.kind === 'UNREACHABLE',
      awaitingSupervisor: awaitingRef.current,
    });
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      void reload();
    }, ZONE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // THE RECIPE, THE SCALES, THE LOT AND THE CONTAINER — re-read when the
  // batch or the active component changes.
  const recipeBatchId = batchId ?? session?.batchId ?? null;
  const activeComponentId = session?.activeComponentId ?? null;

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const [recipeResult, scalesResult] = await Promise.all([
        recipeBatchId === null ? Promise.resolve(null) : fetchRecipe(recipeBatchId),
        fetchScales(),
      ]);
      if (cancelled) return;

      if (recipeResult !== null && recipeResult.kind === 'OK') {
        setRecipe(recipeResult.body.recipe);
      }
      if (scalesResult.kind === 'OK') {
        setScales(scalesResult.body.scales);
      }

      if (activeComponentId === null) {
        setLot(null);
        setContainer(null);
        return;
      }

      const [lotResult, containerResult] = await Promise.all([
        fetchLot(activeComponentId),
        fetchContainer(activeComponentId),
      ]);
      if (cancelled) return;

      setLot(
        lotResult.kind === 'OK' && lotResult.body.capture !== null
          ? lotResult.body.capture
          : null,
      );
      setContainer(
        containerResult.kind === 'OK' && containerResult.body.assignment !== null
          ? containerResult.body.assignment
          : null,
      );
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [recipeBatchId, activeComponentId]);

  // A NEW COMPONENT — the previous one's surplus and escalation are over.
  useEffect(() => {
    setProposal(null);
    setProposalState(null);
    setEscalation(null);
    setEscalationState(null);
    setAwaitingSupervisor(false);
  }, [activeComponentId, setProposalState, setEscalationState]);

  // OVER TOLERANCE — the station is asked for its surplus proposal, once
  // per component, when the reading has come to rest: a pour still moving
  // through OVER would be proposed against a weight it is about to leave.
  const proposedFor = useRef<string | null>(null);
  const lastOverValue = useRef<string | null>(null);
  useEffect(() => {
    if (zone?.zone !== 'OVER' || activeComponentId === null) {
      lastOverValue.current = null;
      return;
    }
    if (proposedFor.current === activeComponentId) return;
    if (lastOverValue.current !== zone.value) {
      lastOverValue.current = zone.value;
      return;
    }
    proposedFor.current = activeComponentId;

    void (async () => {
      const result = await proposeSurplus();
      if (result.kind === 'OK') {
        setProposal(result.body.proposal);
        setProposalState(result.body.proposal);
      }
    })();
  }, [zone?.zone, zone?.value, activeComponentId, setProposalState]);

  const displayable = displayableReading(reading, receivedAt);
  const age = streamAge(receivedAt);

  const activeComponent =
    recipe?.components.find((entry) => entry.componentId === activeComponentId) ??
    null;
  const boundScale = scales.find((scale) => scale.scaleId === scaleId) ?? null;
  const isTrainingScale = boundScale?.source === 'DUMMY';

  // THE RAIL — the recipe's components, each with the session's state.
  const rail: readonly RailComponent[] =
    recipe !== null && recipe.components.length > 0
      ? recipe.components.map((component) => ({
          componentId: component.componentId,
          state:
            session?.components.find(
              (entry) => entry.componentId === component.componentId,
            )?.state ?? component.state,
          name: component.name,
          dyestuffCode: component.dyestuffCode,
          swatchColour: component.swatchColour,
          target: component.target,
          unit: component.unit,
        }))
      : (session?.components ?? []);

  const onConfirm = async (): Promise<void> => {
    if (activeComponentId === null) return;

    begin();
    const result = await confirmComponent(activeComponentId);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.confirm.refused');
      return;
    }

    // THE STATION SAYS THE BATCH IS COMPLETE — so it is completed: the
    // consumption is posted to OrgaTEX, and the completion view follows.
    if (result.body.batchComplete === true) {
      await completeBatch();
      return;
    }

    await reload();
  };

  const onSelect = async (componentId: string): Promise<void> => {
    begin();
    const result = await selectComponent(componentId);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.confirm.refused');
      return;
    }

    await reload();
  };

  const onReTare = async (): Promise<void> => {
    if (scaleId === null) return;

    begin();
    const result = await reTare(scaleId);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.retare.refused');
      return;
    }

    // A re-tared platform starts the component again: the old surplus
    // proposal no longer describes it.
    proposedFor.current = null;
    setProposal(null);
    setProposalState(null);
    await reload();
  };

  const onDispense = async (
    landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
  ): Promise<void> => {
    const result = await trainingDispense(landing);
    if (result.kind !== 'OK') {
      fail('weigh.training.refused');
    }
  };

  const onOverride = async (): Promise<void> => {
    if (activeComponentId === null) return;

    begin();
    const result = await raiseEscalation(activeComponentId);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.escalation.notEscalatable');
      return;
    }

    setEscalation(result.body.escalation);
    setEscalationState(result.body.escalation);
  };

  const onAcceptSurplus = async (): Promise<void> => {
    const componentId = proposal?.componentId ?? activeComponentId ?? '';
    if (componentId === '') return;

    begin();
    const result = await acceptSurplus(componentId);
    if (result.kind === 'OK') {
      setProposal(result.body.proposal);
      setProposalState(result.body.proposal);
    }
    end();
    await reload();
  };

  const onDeclineSurplus = async (): Promise<void> => {
    const componentId = proposal?.componentId ?? activeComponentId ?? '';
    if (componentId === '') return;

    begin();
    const result = await declineSurplus(componentId);
    if (result.kind === 'OK') {
      setProposal(result.body.proposal);
      setProposalState(result.body.proposal);
    }
    end();
  };

  const onAuthorise = async (input: {
    readonly authorisationId: string;
    readonly supervisorId: string;
    readonly secret: string;
    readonly reason: string;
  }): Promise<void> => {
    if (input.reason.trim().length === 0) {
      fail('weigh.escalation.refused');
      return;
    }

    begin();
    const result = await authoriseEscalation(
      input.authorisationId,
      input.supervisorId,
      input.secret,
      input.reason,
    );

    if (result.kind !== 'OK') {
      fail('weigh.escalation.refused');
      setAwaitingSupervisor(true);
      end();
      return;
    }

    setAwaitingSupervisor(false);
    setEscalation(null);
    setEscalationState(null);
    end();
    await reload();
  };

  // THE READOUT'S UNIT IS THE COMPONENT'S. The stream speaks the device's
  // unit (grams, on the 32 kg floor scale); the station converts into the
  // recipe's (kilograms) and reports it with the zone. So when the two
  // differ, the readout shows the station's converted value — the client
  // converts nothing — and target, still-to-weigh and weight share a unit.
  const converted =
    displayable !== null && zone !== null && displayable.unit !== zone.unit;
  const liveValue = converted ? zone.value : (displayable?.value ?? null);
  const unit = converted ? zone.unit : (displayable?.unit ?? zone?.unit ?? null);
  const notice = failure ?? workflowRefusal;

  return (
    <main
      className="stage"
      data-testid="weigh-screen"
      data-link={linkState ?? 'UNKNOWN'}
      aria-label={t('weigh.title')}
    >
      <RecipeRail
        components={rail}
        shadeCode={recipe?.shadeCode ?? null}
        batchId={session?.batchId ?? recipeBatchId}
        weighed={session?.counter.weighed ?? 0}
        total={session?.counter.total ?? rail.length}
        t={t}
        onSelect={(componentId) => {
          void onSelect(componentId);
        }}
      />

      <section className="weigh">
        {/* THE WEIGH-HEAD — who is being weighed, and in what. Every value
            is the API's. */}
        <WeighHead
          name={activeComponent?.name ?? null}
          dyestuffCode={activeComponent?.dyestuffCode ?? null}
          componentId={activeComponentId ?? ''}
          lotNumber={lot?.lotNumber ?? null}
          containerId={container?.containerId ?? null}
          scaleLabel={boundScale?.label ?? null}
          t={t}
        />

        <LiveReadout
          value={liveValue}
          unit={unit}
          stillToWeigh={zone?.stillToWeigh ?? null}
          target={zone?.target ?? null}
          zone={zone?.zone ?? null}
          ageMs={age}
          t={t}
        />

        <ToleranceBand
          zone={zone?.zone ?? null}
          okLower={zone?.bounds?.okLower ?? null}
          okUpper={zone?.bounds?.okUpper ?? null}
          target={zone?.target ?? null}
          unit={zone?.unit ?? null}
          capacityMax={
            boundScale === null ? null : `${boundScale.capacity} ${boundScale.unit}`
          }
          current={zone?.value ?? null}
          t={t}
        />

        <StatusLine
          zone={zone?.zone ?? null}
          stable={displayable?.stable ?? null}
          stillToWeigh={zone?.stillToWeigh ?? null}
          unit={zone?.unit ?? null}
          t={t}
        />

        {/* THE TRAINING BAR — the prototype's simulation, driving the DUMMY
            scale through its own API. Never shown for a real device. */}
        {isTrainingScale && activeComponentId !== null && (
          <div className="training" data-testid="training-bar">
            <span className="k-label">{t('weigh.training.label')}</span>
            <button
              type="button"
              className="key"
              data-testid="training-dispense"
              disabled={busy}
              onClick={() => {
                void onDispense('IN_TOLERANCE');
              }}
              style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX * 0.8}px` }}
            >
              {t('weigh.training.dispense')}
            </button>
            <button
              type="button"
              className="key ghost"
              data-testid="training-overshoot"
              disabled={busy}
              onClick={() => {
                void onDispense('OVER_TOLERANCE');
              }}
              style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX * 0.8}px` }}
            >
              {t('weigh.training.overshoot')}
            </button>
          </div>
        )}

        {notice !== null && (
          <div className="alert" data-testid="weigh-failure" role="alert">
            {t(notice)}
          </div>
        )}

        {/* THE SURPLUS PANEL — shown only when the station proposed one. */}
        <SurplusPanel
          proposal={proposal}
          t={t}
          onAccept={() => {
            void onAcceptSurplus();
          }}
          onDecline={() => {
            void onDeclineSurplus();
          }}
        />

        {/* THE ESCALATION PANEL — the supervisor override. */}
        <EscalationPanel
          escalation={escalation}
          awaitingSupervisor={awaitingSupervisor}
          failure={failure}
          t={t}
          onAuthorise={(input) => {
            void onAuthorise(input);
          }}
          onDiscard={() => {
            setEscalation(null);
            setEscalationState(null);
            setAwaitingSupervisor(false);
          }}
        />

        {/* THE ACTION ROW — and the reason is ALWAYS beside the button. */}
        <ActionRow
          confirm={confirm}
          busy={busy}
          canReTare={scaleId !== null}
          t={t}
          onConfirm={() => {
            void onConfirm();
          }}
          onReTare={() => {
            void onReTare();
          }}
          onAbandon={quit}
          onOverride={() => {
            void onOverride();
          }}
        />
      </section>
    </main>
  );
}
