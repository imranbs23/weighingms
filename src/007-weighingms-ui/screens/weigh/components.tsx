/**
 * The weigh view's components.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ZONE IS RECEIVED. THE CLIENT COMPUTES NO ZONE AND NO BAND.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"No consumer — in particular no screen — computes it independently (FR-9,
 * BRD FR-16, BRD FR-17)."*
 *
 * **And the three elements share one `data-zone` attribute** — the
 * indicator, the live-weight cell and the status line — so the zone is
 * **visibly consistent** across them (FR-9).
 *
 * **And a stale reading shows NO VALUE** — never `0.0` (B-1).
 */
import { formatQuantity, positionInRange } from '../../format/quantity.js';
import type { Translate } from '../../i18n/useStrings.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

/** The zone's colour — and it is the API's zone, mapped to a colour. */
function zoneColour(zone: string | null): string {
  switch (zone) {
    case 'OK':
      return COLOURS.success;
    case 'NEAR':
      return COLOURS.warning;
    case 'OVER':
    case 'UNDER':
      return COLOURS.danger;
    default:
      return COLOURS.textMuted;
  }
}

/**
 * The weigh-head — **who is being weighed, and in what**.
 *
 * The prototype shows the dyestuff's name and a meta line carrying its
 * code, its lot and its container.
 *
 * **And every one of those values is the API's** — the name and the
 * dyestuff code from the recipe, the lot from unit `002`'s capture, the
 * container from its assignment, and the tare from the scale.
 */
export function WeighHead({
  name,
  dyestuffCode,
  componentId,
  lotNumber,
  containerId,
  scaleLabel,
  t,
}: {
  readonly name: string | null;
  readonly dyestuffCode: string | null;
  readonly componentId: string;
  readonly lotNumber: string | null;
  readonly containerId: string | null;
  readonly scaleLabel: string | null;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div data-testid="weigh-head" style={{ display: 'flex', gap: SPACING.lg }}>
      <div>
        {/* THE NAME — and it is the MES's. A name the MES did not supply
            renders the client's own placeholder, never a fabricated one. */}
        <div data-testid="weigh-name" style={{ fontSize: `${MIN_LABEL_PX * 1.4}px` }}>
          {name ?? t('weigh.head.noName')}
        </div>
        <div data-testid="weigh-meta" style={{ color: COLOURS.textMuted }}>
          {[
            dyestuffCode ?? componentId,
            lotNumber,
            containerId,
          ]
            .filter((part): part is string => part !== null && part.length > 0)
            .join(' · ')}
        </div>
      </div>

      {/* THE SCALE — and it was selected by the RULE, not by the operator
          (BRD BR-05). */}
      {scaleLabel !== null && (
        <div data-testid="weigh-scale" style={{ marginLeft: 'auto' }}>
          <div style={{ color: COLOURS.textMuted, fontSize: `${MIN_LABEL_PX * 0.8}px` }}>
            {t('weigh.head.scaleSelected')}
          </div>
          <div style={{ fontSize: `${MIN_LABEL_PX}px` }}>{scaleLabel}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The recipe rail — the component states, and the rail's head.
 */
export function RecipeRail({
  components,
  shadeCode,
  batchId,
  weighed,
  total,
  t,
  onSelect,
}: {
  readonly components: readonly {
    readonly componentId: string;
    readonly state: string;
  }[];
  readonly shadeCode: string | null;
  readonly batchId: string | null;
  readonly weighed: number;
  readonly total: number;
  readonly t: Translate;
  readonly onSelect: (componentId: string) => void;
}): React.JSX.Element {
  return (
    <nav
      data-testid="recipe-rail"
      aria-label={t('weigh.rail.label')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${COLOURS.border}`,
        padding: SPACING.md,
      }}
    >
      {/* THE RAIL'S HEAD — the shade, the batch and the count. */}
      <div data-testid="rail-head">
        <div data-testid="rail-shade">
          {shadeCode === null ? t('weigh.rail.noShade') : shadeCode}
        </div>
        {batchId !== null && (
          <div data-testid="rail-batch">{batchId}</div>
        )}
        <div data-testid="rail-count">
          {t('weigh.rail.weighed')}: {weighed}/{total}
        </div>
      </div>

      {components.map((component) => {
        // A `DONE` component is TERMINAL and cannot be selected (C-08).
        const selectable = component.state !== 'DONE';
        return (
          <button
            key={component.componentId}
            type="button"
            data-testid={`rail-component-${component.componentId}`}
            data-state={component.state}
            disabled={!selectable}
            onClick={() => {
              if (!selectable) return;
              onSelect(component.componentId);
            }}
            style={{
              minHeight: `${TOUCH_TARGET_PX}px`,
              textAlign: 'left',
              opacity: selectable ? 1 : 0.55,
              fontSize: `${MIN_LABEL_PX}px`,
            }}
          >
            {component.componentId} — {component.state}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The live readout — the weight, the still-to-weigh and the target.
 *
 * **And a stale or missing reading shows NO VALUE** — never `0.0` (B-1).
 */
export function LiveReadout({
  value,
  unit,
  stillToWeigh,
  target,
  zone,
  ageMs,
  t,
}: {
  readonly value: string | null;
  readonly unit: string | null;
  readonly stillToWeigh: string | null;
  readonly target: string | null;
  readonly zone: string | null;
  readonly ageMs: number | null;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <section data-testid="live-readout" data-zone={zone ?? 'NONE'}>
      <div
        data-testid="live-weight-value"
        style={{
          color: zoneColour(zone),
          fontSize: `${MIN_LABEL_PX * 3}px`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value === null || unit === null
          ? // THE EMPTY STATE — and NOT a zero. A `0.0` fallback would be
            // indistinguishable from a genuinely empty scale (B-1).
            t('weigh.readout.noValue')
          : formatQuantity(value, unit)}
      </div>

      <div data-testid="live-weight-unit">{unit ?? ''}</div>

      <div data-testid="live-still-to-weigh">
        {t('weigh.readout.stillToWeigh')}:{' '}
        {stillToWeigh === null || unit === null
          ? t('weigh.readout.noValue')
          : formatQuantity(stillToWeigh, unit)}
      </div>

      <div data-testid="live-target">
        {t('weigh.readout.target')}:{' '}
        {target === null || unit === null
          ? t('weigh.readout.noValue')
          : formatQuantity(target, unit)}
      </div>

      {/* THE STREAM'S AGE — so the operator can see when the data falls
          behind. */}
      <div data-testid="live-stream-age">
        {ageMs === null
          ? t('weigh.readout.noValue')
          : `${ageMs} ms`}
      </div>
    </section>
  );
}

/**
 * The tolerance band — the indicator.
 *
 * **And the band is ALWAYS visible**, whether or not the zone is `OK`
 * (FR-8, FR-9).
 *
 * **And it is accessible**: `role="progressbar"` with `aria-valuenow`.
 */
export function ToleranceBand({
  zone,
  okLower,
  okUpper,
  capacityMax,
  current,
  t,
}: {
  readonly zone: string | null;
  readonly okLower: string | null;
  readonly okUpper: string | null;
  readonly capacityMax: string | null;
  readonly current: string | null;
  readonly t: Translate;
}): React.JSX.Element {
  const percentage =
    current === null || okLower === null || okUpper === null
      ? null
      : positionInRange(current, okLower, okUpper);

  return (
    <section data-testid="tolerance-band" data-zone={zone ?? 'NONE'}>
      <div
        role="progressbar"
        aria-valuenow={percentage ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('weigh.band.label')}
        data-testid="tolerance-band-bar"
        style={{
          height: '28px',
          background: COLOURS.surfaceRaised,
          border: `1px solid ${COLOURS.border}`,
          position: 'relative',
        }}
      >
        {/* THE BAND — from the API's bounds, never recomputed. */}
        {percentage !== null && (
          <div
            data-testid="tolerance-band-range"
            style={{
              position: 'absolute',
              inset: 0,
              background: zoneColour(zone),
              opacity: 0.35,
            }}
          />
        )}
      </div>

      <div data-testid="tolerance-band-scale-capacity">
        {t('weigh.band.scaleCapacity')}:{' '}
        {capacityMax === null ? t('weigh.readout.noValue') : capacityMax}
      </div>
    </section>
  );
}

/**
 * The status line — a plain statement of where the operator stands.
 *
 * **And it carries the same `data-zone`** as the readout and the band, so
 * the three cannot disagree.
 */
export function StatusLine({
  zone,
  stable,
  t,
}: {
  readonly zone: string | null;
  readonly stable: boolean | null;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <p
      data-testid="status-line"
      data-zone={zone ?? 'NONE'}
      style={{ color: zoneColour(zone), fontSize: `${MIN_LABEL_PX * 1.2}px` }}
    >
      {zone === null
        ? t('weigh.status.unknown')
        : t(`weigh.zone.${zone.toLowerCase()}`)}
      {stable === false ? ` — ${t('weigh.status.settling')}` : ''}
    </p>
  );
}
