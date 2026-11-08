/**
 * WeighScreen — the live weight view.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT RENDERS. IT NEVER DECIDES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The zone comes from the API. The quantity is the API's. The unit is the
 * API's. And the client converts **nothing** — it formats.
 */
import { useEffect, useState } from 'react';
import {
  acceptSurplus,
  authoriseEscalation,
  confirmComponent,
  declineSurplus,
  fetchContainer,
  fetchEscalation,
  fetchLot,
  fetchRecipe,
  fetchScales,
  fetchSession,
  fetchSurplus,
  fetchZone,
  proposeSurplus,
  selectComponent,
  type EscalationReport,
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
import {
  CONFIRM_REASON_NO_COMPONENT,
  CONFIRM_REASON_OVERRIDE_REQUIRED,
  CONFIRM_REASON_UNREACHABLE,
  CONFIRM_REASON_WORKING,
  useActionStore,
} from '../../state/action-store.js';
import {
  LiveReadout,
  RecipeRail,
  StatusLine,
  ToleranceBand,
  WeighHead,
} from './components.js';
import { ActionRow } from './ActionRow.js';
import { SurplusPanel } from './SurplusPanel.js';
import { EscalationPanel } from './EscalationPanel.js';

/** Every locale key the weigh view uses. */
export const WEIGH_KEYS = [
  'weigh.title',
  'weigh.rail.label',
  'weigh.rail.noShade',
  'weigh.rail.weighed',
  'weigh.head.noName',
  'weigh.head.scaleSelected',
  'weigh.readout.noValue',
  'weigh.readout.stillToWeigh',
  'weigh.readout.target',
  'weigh.band.label',
  'weigh.band.scaleCapacity',
  'weigh.status.unknown',
  'weigh.status.settling',
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
  'weigh.confirm.working',
  'weigh.abandon.caption',
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
] as const;

export function WeighScreen(): React.JSX.Element {
  const t = useStrings(WEIGH_KEYS);

  const [session, setSession] = useState<SessionSnapshot | null>(null);
  /**
   * THE ZONE — and it is the API's **flat** body.
   *
   * The controller answers `{ zone, value, unit, target, tolerance, bounds,
   * stillToWeigh }` — the zone's own name is the `zone` field. And when
   * there is no zone the answer is `{ zone: null }` and **nothing else**,
   * so the whole record is `null` then.
   */
  const [zone, setZone] = useState<{
    zone: string;
    value: string;
    unit: string;
    target: string;
    bounds: {
      nearThreshold: string;
      okLower: string;
      okUpper: string;
    } | null;
    stillToWeigh: string;
  } | null>(null);
  const [proposal, setProposal] = useState<SurplusProposal | null>(null);
  const [escalation, setEscalation] = useState<EscalationReport | null>(null);
  const [awaitingSupervisor, setAwaitingSupervisor] = useState(false);

  // THE WEIGH-HEAD's facts — and every one of them is the API's.
  const [recipe, setRecipe] = useState<{
    batchId: string;
    shadeCode: string;
    components: readonly {
      sequence: number;
      componentId: string;
      dyestuffCode: string;
      name: string | null;
      target: string;
      unit: string;
    }[];
  } | null>(null);
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

  const reading = useWeighStore((s) => s.reading);
  const receivedAt = useWeighStore((s) => s.receivedAt);
  const linkState = useWeighStore((s) => s.linkState);

  // THE STREAM. The device's readings are PUSHED — the client never
  // polls, because polling would spend NFR-01's transport budget on
  // request overhead and could not tell a disconnected indicator from a
  // stationary weight.
  const scaleId = session?.selectedScaleId ?? null;
  useWeightStream(scaleId);

  /**
   * Re-read the session and the zone.
   *
   * **And the client renders what the API reports** — it never computes
   * the next component, and never computes a zone.
   */
  const reload = async (): Promise<void> => {
    const [sessionResult, zoneResult] = await Promise.all([
      fetchSession(),
      fetchZone(),
    ]);

    if (sessionResult.kind !== 'OK') {
      // THE API IS UNREACHABLE — and the client does NOT confirm
      // optimistically and does not show a success it cannot verify
      // (BRD FR-20).
      setZoneAction(null, { unreachable: true });
      return;
    }

    setSession(sessionResult.body.session);

    // THE ZONE — the API's **flat** body. When the answer is
    // `{ zone: null }` there is no zone and no quantities, so the whole
    // record is `null` — and the action says why.
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

    const active = sessionResult.body.session?.activeComponentId ?? null;
    setZoneAction(
      zoneResult.kind === 'OK' ? zoneResult.body.zone : null,
      {
        noComponent: active === null,
        unreachable: zoneResult.kind === 'UNREACHABLE',
        working: sessionResult.body.session?.state === 'WEIGHING' && active !== null,
        awaitingSupervisor,
      },
    );
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE WEIGH-HEAD's facts — loaded with the session, and reloaded when
  // the active component changes.
  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const batchId = session?.batchId ?? null;
      const componentId = session?.activeComponentId ?? null;

      const [recipeResult, scalesResult] = await Promise.all([
        batchId === null
          ? Promise.resolve(null)
          : fetchRecipe(batchId),
        fetchScales(),
      ]);
      if (cancelled) return;

      if (recipeResult !== null && recipeResult.kind === 'OK') {
        // THE RECIPE — and it is **nested under `recipe`** on the wire.
        setRecipe(recipeResult.body.recipe);
      }
      if (scalesResult.kind === 'OK') {
        setScales(scalesResult.body.scales);
      }

      if (componentId === null) {
        setLot(null);
        setContainer(null);
        return;
      }

      const [lotResult, containerResult] = await Promise.all([
        fetchLot(componentId),
        fetchContainer(componentId),
      ]);
      if (cancelled) return;

      // THE CAPTURE — and it is `capture` on the wire, not `lot`.
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
  }, [session?.batchId, session?.activeComponentId]);

  // The displayed reading — **or `null` when it is stale**. Never `0.0`.
  const displayable = displayableReading(reading, receivedAt);
  const age = streamAge(receivedAt);

  // THE ACTIVE COMPONENT — from the recipe.
  const activeComponent =
    recipe?.components.find(
      (entry) => entry.componentId === session?.activeComponentId,
    ) ?? null;

  // THE BOUND SCALE — and it was selected by the RULE (BRD BR-05).
  const boundScale =
    scales.find((scale) => scale.scaleId === session?.selectedScaleId) ?? null;

  /**
   * Confirm — and then the API decides what happens next.
   *
   * **The client does NOT compute the progression.** It re-reads the
   * session and renders the `activeComponentId` the API reports.
   */
  const onConfirm = async (): Promise<void> => {
    const active = session?.activeComponentId ?? null;
    if (active === null) return;

    begin();
    const result = await confirmComponent(active);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.escalation.refused');
      return;
    }

    await reload();
  };

  const onSelect = async (componentId: string): Promise<void> => {
    begin();
    const result = await selectComponent(componentId);
    end();

    if (result.kind !== 'OK') {
      fail('weigh.escalation.refused');
      return;
    }

    await reload();
  };

  const onAbandon = async (): Promise<void> => {
    const active = session?.activeComponentId ?? null;
    if (active === null) return;

    begin();
    // The abandon is the session's own transition — the client asks, and
    // the API decides.
    const result = await selectComponent(active);
    end();
    await reload();
  };

  const onDetectSurplus = async (): Promise<void> => {
    begin();
    const result = await proposeSurplus();
    if (result.kind === 'OK') {
      setProposal(result.body.proposal);
      setProposalState(result.body.proposal);
    }
    end();
  };

  const onAcceptSurplus = async (): Promise<void> => {
    const componentId = proposal?.componentId ?? session?.activeComponentId ?? '';
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
    const componentId = proposal?.componentId ?? session?.activeComponentId ?? '';
    if (componentId === '') return;

    begin();
    const result = await declineSurplus(componentId);
    if (result.kind === 'OK') {
      setProposal(result.body.proposal);
      setProposalState(result.body.proposal);
    }
    end();
    // A declined proposal HOLDS the batch — and the client does not
    // confirm it.
  };

  const onAuthorise = async (input: {
    readonly authorisationId: string;
    readonly supervisorId: string;
    readonly secret: string;
    readonly reason: string;
  }): Promise<void> => {
    // THE REASON IS REQUIRED — and the panel's button is disabled without
    // one. The check here is the second line.
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
      // The weighing is NOT confirmed, and the prompt stays open.
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

  return (
    <main data-testid="weigh-screen" data-link={linkState ?? 'UNKNOWN'}>
      <h1>{t('weigh.title')}</h1>

      <RecipeRail
        components={session?.components ?? []}
        shadeCode={recipe?.shadeCode ?? null}
        batchId={session?.batchId ?? null}
        weighed={session?.counter.weighed ?? 0}
        total={session?.counter.total ?? 0}
        t={t}
        onSelect={(componentId) => {
          void onSelect(componentId);
        }}
      />

      {/* THE WEIGH-HEAD — who is being weighed, and in what. Every value
          is the API's. */}
      <WeighHead
        name={activeComponent?.name ?? null}
        dyestuffCode={activeComponent?.dyestuffCode ?? null}
        componentId={session?.activeComponentId ?? ''}
        lotNumber={lot?.lotNumber ?? null}
        containerId={container?.containerId ?? null}
        scaleLabel={boundScale?.label ?? null}
        t={t}
      />

      <LiveReadout
        value={displayable?.value ?? null}
        unit={displayable?.unit ?? zone?.unit ?? null}
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
        capacityMax={null}
        // THE API'S VALUE — the zone response carries the current weight,
        // because the zone is computed from it. So the band is right from
        // the first render, before the stream's first frame arrives.
        current={zone?.value ?? null}
        t={t}
      />

      <StatusLine
        zone={zone?.zone ?? null}
        stable={displayable?.stable ?? null}
        t={t}
      />

      {/* THE ACTION ROW — and the reason is ALWAYS beside the button. */}
      <ActionRow
        confirm={confirm}
        busy={busy}
        t={t}
        onConfirm={() => {
          void onConfirm();
        }}
        onAbandon={() => {
          void onAbandon();
        }}
      />

      {/* THE SURPLUS PANEL — shown only when the API reports a surplus. */}
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

      {/* THE ESCALATION PANEL. */}
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
    </main>
  );
}
