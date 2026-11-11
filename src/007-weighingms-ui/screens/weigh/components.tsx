/**
 * The weigh view's parts — the prototype's, element for element.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ZONE IS RECEIVED. THE CLIENT COMPUTES NO ZONE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The readout, the bar and the status line carry the API's zone as one
 * `data-zone`, so the three cannot disagree. The bar's geometry — where the
 * fill, the band and the target line are drawn — is presentation, done in
 * fixed-point (`format/quantity.ts`), and decides nothing.
 */
import {
  displayMaximum,
  formatQuantity,
  halfWidth,
  positionInRange,
} from '../../format/quantity.js';
import type { Translate } from '../../i18n/useStrings.js';
import { MIN_LABEL_PX, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

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
    <div className="weigh-head" data-testid="weigh-head">
      <div className="who">
        {/* THE NAME — and it is the MES's. A name the MES did not supply
            renders the client's own placeholder, never a fabricated one. */}
        <div className="nm" data-testid="weigh-name">
          {name ?? t('weigh.head.noName')}
        </div>
        <div className="meta" data-testid="weigh-meta">
          {[dyestuffCode ?? componentId, lotNumber, containerId]
            .filter((part): part is string => part !== null && part.length > 0)
            .join(' · ')}
        </div>
      </div>

      {/* THE SCALE — and it was selected by the RULE, not by the operator
          (BRD BR-05). */}
      {scaleLabel !== null && (
        <div className="scale-badge" data-testid="weigh-scale">
          <span className="k-label">{t('weigh.head.scaleSelected')}</span>
          <span className="v">{scaleLabel}</span>
        </div>
      )}
    </div>
  );
}

/** One rail entry — the session's state, and the recipe's facts when read. */
export interface RailComponent {
  readonly componentId: string;
  readonly state: string;
  readonly name?: string | null;
  readonly dyestuffCode?: string;
  readonly swatchColour?: string | null;
  readonly target?: string;
  readonly unit?: string;
}

export function RecipeRail({
  components,
  shadeCode,
  batchId,
  weighed,
  total,
  t,
  onSelect,
}: {
  readonly components: readonly RailComponent[];
  readonly shadeCode: string | null;
  readonly batchId: string | null;
  readonly weighed: number;
  readonly total: number;
  readonly t: Translate;
  readonly onSelect: (componentId: string) => void;
}): React.JSX.Element {
  return (
    <nav className="rail" data-testid="recipe-rail" aria-label={t('weigh.rail.label')}>
      {/* THE RAIL'S HEAD — the shade, the batch and the count. */}
      <div className="rail-head" data-testid="rail-head">
        <span className="k-label">
          {t('weigh.rail.label')} ·{' '}
          <span data-testid="rail-shade">
            {shadeCode === null ? t('weigh.rail.noShade') : shadeCode}
          </span>
        </span>
        {batchId !== null && (
          <span className="v" data-testid="rail-batch">
            {batchId}
          </span>
        )}
        <span className="m" data-testid="rail-count">
          {weighed}/{total} {t('weigh.rail.weighed')}
        </span>
      </div>

      {components.map((component) => {
        const selectable = component.state !== 'DONE';
        return (
          <button
            key={component.componentId}
            type="button"
            className="comp"
            data-testid={`rail-component-${component.componentId}`}
            data-state={component.state}
            disabled={!selectable}
            onClick={() => {
              if (!selectable) return;
              onSelect(component.componentId);
            }}
            style={{ minHeight: `${TOUCH_TARGET_PX}px` }}
          >
            <span
              className="swatch"
              style={
                component.swatchColour === undefined ||
                component.swatchColour === null
                  ? undefined
                  : { background: component.swatchColour }
              }
            />
            <span>
              <span className="nm">{component.name ?? component.componentId}</span>
              <br />
              <span className="sub">
                {component.dyestuffCode ?? component.componentId}
              </span>
            </span>
            <span>
              {component.target !== undefined && component.unit !== undefined && (
                <span className="qty">
                  {formatQuantity(component.target, component.unit)}{' '}
                  {component.unit}
                </span>
              )}
              <br />
              <span className="st">
                {t(`weigh.rail.state.${component.state.toLowerCase()}`)}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

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
    <section className="readout" data-testid="live-readout" data-zone={zone ?? 'NONE'}>
      <div className="cell live">
        <span className="k-label">{t('weigh.readout.weighedNow')}</span>
        <div
          className="v"
          data-testid="live-weight-value"
          style={{ color: zoneColour(zone) }}
        >
          {value === null || unit === null
            ? // THE EMPTY STATE — and NOT a zero. A `0.0` fallback would be
              // a weight the scale never reported.
              t('weigh.readout.noValue')
            : formatQuantity(value, unit)}
          <span className="u" data-testid="live-weight-unit">
            {unit ?? ''}
          </span>
        </div>
        {/* THE STREAM'S AGE — so the operator can see when data falls behind. */}
        <span className="age" data-testid="live-stream-age">
          {ageMs === null ? t('weigh.readout.noValue') : `${ageMs} ms`}
        </span>
      </div>

      <div className="cell">
        <span className="k-label">{t('weigh.readout.stillToWeigh')}</span>
        <div className="v" data-testid="live-still-to-weigh">
          {stillToWeigh === null || unit === null
            ? t('weigh.readout.noValue')
            : formatQuantity(stillToWeigh, unit)}
          <span className="u">{unit ?? ''}</span>
        </div>
      </div>

      <div className="cell">
        <span className="k-label">{t('weigh.readout.target')}</span>
        <div className="v" data-testid="live-target">
          {target === null || unit === null
            ? t('weigh.readout.noValue')
            : formatQuantity(target, unit)}
          <span className="u">{unit ?? ''}</span>
        </div>
      </div>
    </section>
  );
}

export function ToleranceBand({
  zone,
  okLower,
  okUpper,
  target,
  unit,
  capacityMax,
  current,
  t,
}: {
  readonly zone: string | null;
  readonly okLower: string | null;
  readonly okUpper: string | null;
  readonly target?: string | null;
  readonly unit?: string | null;
  /** The bound scale's capacity — "3000 g" — shown, never used to judge. */
  readonly capacityMax: string | null;
  readonly current: string | null;
  readonly t: Translate;
}): React.JSX.Element {
  // ACCESSIBILITY — the reading's position within the tolerance band.
  const percentage =
    current === null || okLower === null || okUpper === null
      ? null
      : positionInRange(current, okLower, okUpper);

  // THE DRAWING — against the prototype's display range, a third above
  // the target, so the target line sits at three quarters of the bar.
  const axisMax =
    target === null || target === undefined ? null : displayMaximum(target);
  const at = (value: string | null): number | null =>
    value === null || axisMax === null
      ? null
      : positionInRange(value, '0', axisMax);
  const fill = at(current);
  const lo = at(okLower);
  const hi = at(okUpper);
  const targetAt = at(target ?? null);
  const shownUnit = unit ?? '';

  return (
    <section className="bar-block" data-testid="tolerance-band" data-zone={zone ?? 'NONE'}>
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={percentage ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('weigh.band.label')}
        data-testid="tolerance-band-bar"
        data-zone={zone ?? 'NONE'}
      >
        {fill !== null && (
          <div className="fill" data-testid="tolerance-band-fill" style={{ width: `${fill}%` }} />
        )}
        {/* THE BAND — from the API's bounds, never recomputed. */}
        {lo !== null && hi !== null && (
          <div
            className="band"
            data-testid="tolerance-band-range"
            style={{ left: `${lo}%`, width: `${Math.max(0.6, hi - lo)}%` }}
          />
        )}
        {targetAt !== null && (
          <div className="target-line" style={{ left: `${targetAt}%` }} />
        )}
      </div>

      <div className="bar-caption">
        <span>0</span>
        <span data-testid="tolerance-band-caption">
          {okLower !== null && okUpper !== null && unit !== null && unit !== undefined
            ? `${t('weigh.band.label')} ±${formatQuantity(halfWidth(okLower, okUpper), unit)} ${shownUnit} (${formatQuantity(okLower, unit)} – ${formatQuantity(okUpper, unit)})`
            : t('weigh.band.label')}
        </span>
        <span data-testid="tolerance-band-scale-capacity">
          {axisMax !== null && unit !== null && unit !== undefined
            ? `${formatQuantity(axisMax, unit)} ${shownUnit}`
            : capacityMax === null
              ? t('weigh.readout.noValue')
              : capacityMax}
        </span>
      </div>
    </section>
  );
}

export function StatusLine({
  zone,
  stable,
  stillToWeigh = null,
  unit = null,
  t,
}: {
  readonly zone: string | null;
  readonly stable: boolean | null;
  readonly stillToWeigh?: string | null;
  readonly unit?: string | null;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <p
      className="status-line"
      data-testid="status-line"
      data-zone={zone ?? 'NONE'}
      style={{ fontSize: `${MIN_LABEL_PX}px` }}
    >
      {zone === null
        ? t('weigh.status.unknown')
        : t(`weigh.zone.${zone.toLowerCase()}`)}
      {/* THE PROTOTYPE'S "— 94.0 g REMAINING", while there is some. */}
      {(zone === 'UNDER' || zone === 'NEAR') &&
        stillToWeigh !== null &&
        unit !== null &&
        ` — ${formatQuantity(stillToWeigh, unit)} ${unit} ${t('weigh.status.remaining')}`}
      {stable === false ? ` — ${t('weigh.status.settling')}` : ''}
    </p>
  );
}

function zoneColour(zone: string | null): string | undefined {
  switch (zone) {
    case 'OK':
      return 'var(--ok)';
    case 'NEAR':
      return 'var(--warn)';
    case 'OVER':
      return 'var(--over)';
    default:
      return undefined;
  }
}
