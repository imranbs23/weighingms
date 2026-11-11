/**
 * SurplusPanel — the over-dose, for information.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SURPLUS IS SHOWN. NOTHING IS RECALCULATED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The Step 24 decision (ADR-047): an over-tolerance component is never
 * confirmed automatically and no recipe is recalculated. The operator is
 * shown how much is over, and the two defined ways forward — re-tare and
 * re-weigh, or a supervisor override.
 *
 * The proportional-compensation proposal (bolt `015`) is withdrawn from
 * the operator until FCI answers Q25/Q26 (brief A-08). So this panel has
 * no factor, no revised targets and no Accept/Decline.
 *
 * **And the panel appears ONLY when the API reports a surplus** — the
 * quantities are the detector's, rendered and never derived.
 */
import { formatQuantity } from '../../format/quantity.js';
import type { SurplusReport } from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import { COLOURS, MIN_LABEL_PX, SPACING } from '../batch-queue/tokens.js';

export function SurplusPanel({
  surplus,
  t,
}: {
  readonly surplus: SurplusReport | null;
  readonly t: Translate;
}): React.JSX.Element | null {
  // THE PANEL APPEARS ONLY WHEN THE API REPORTS A SURPLUS.
  if (surplus === null) return null;

  return (
    <section
      className="panel"
      data-testid="surplus-panel"
      style={{
        border: `1px solid ${COLOURS.warning}`,
        padding: SPACING.md,
        fontSize: `${MIN_LABEL_PX}px`,
      }}
    >
      <h2>{t('weigh.surplus.heading')}</h2>

      {/* THE SURPLUS — as an absolute quantity and a percentage. */}
      <div data-testid="surplus-amount">
        {t('weigh.surplus.amount')}:{' '}
        {formatQuantity(surplus.surplusAmount, surplus.unit)} {surplus.unit}
      </div>
      <div data-testid="surplus-percent">
        {t('weigh.surplus.percent')}:{' '}
        {surplus.surplusPercent === null
          ? t('weigh.readout.noValue')
          : `${surplus.surplusPercent} %`}
      </div>

      {/* THE TWO WAYS FORWARD — the decided rule, stated. */}
      <p data-testid="surplus-recovery" style={{ color: COLOURS.textMuted }}>
        {t('weigh.surplus.recovery')}
      </p>
    </section>
  );
}
