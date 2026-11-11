/**
 * SurplusPanel — the over-dose's proposal.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTOR IS RENDERED. NEVER DERIVED. AND BOTH WAYS FORWARD ARE
 * OFFERED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"The surplus ratio is `surplus ÷ totalRemainingTarget`, **never a
 * hard-coded constant**. The prototype carries a worked example of its own,
 * and it is correct only for that one example. The factor is derived per
 * proposal from the surplus the API reports and the remaining total the API
 * reports; **the client does not carry a constant and does not re-derive
 * the revised targets, it renders them**" (FR-12, A-08, BRD R-03).
 *
 * **And accepting and declining are BOTH legitimate:**
 *
 * *"The UI does not push the operator toward acceptance — a panel that only
 * offers one way forward is a nudge dressed as a control."*
 *
 * **And the panel appears ONLY when the API reports a surplus** — the
 * visibility rule is a rendering concern, and the domain exposes the
 * surplus and the proposal and never decides what the operator should
 * see.
 */
import { formatQuantity } from '../../format/quantity.js';
import type { SurplusProposal } from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

export function SurplusPanel({
  proposal,
  t,
  onAccept,
  onDecline,
}: {
  readonly proposal: SurplusProposal | null;
  readonly t: Translate;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}): React.JSX.Element | null {
  // THE PANEL APPEARS ONLY WHEN THE API REPORTS A SURPLUS.
  if (proposal === null) return null;

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
        {formatQuantity(proposal.surplusAmount, proposal.unit)}
      </div>
      <div data-testid="surplus-percent">
        {t('weigh.surplus.percent')}:{' '}
        {proposal.surplusPercent ?? t('weigh.readout.noValue')}
      </div>

      {/* THE FACTOR — RENDERED, NOT DERIVED. */}
      <div data-testid="surplus-factor">
        {t('weigh.surplus.factor')}: {proposal.factor}
      </div>

      {/* EACH COMPONENT'S ORIGINAL AND REVISED TARGET. */}
      <table data-testid="surplus-recalculated">
        <thead>
          <tr>
            <th>{t('weigh.surplus.component')}</th>
            <th>{t('weigh.surplus.originalTarget')}</th>
            <th>{t('weigh.surplus.revisedTarget')}</th>
          </tr>
        </thead>
        <tbody>
          {proposal.recalculated.map((entry) => (
            <tr
              key={entry.componentId}
              data-testid={`surplus-entry-${entry.componentId}`}
            >
              <td>{entry.componentId}</td>
              <td>{entry.originalTarget}</td>
              <td data-testid={`surplus-revised-${entry.componentId}`}>
                {entry.revisedTarget}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* THE FOOTNOTE — the shade ratio is preserved. */}
      <p data-testid="surplus-footnote" style={{ color: COLOURS.textMuted }}>
        {t('weigh.surplus.footnote')}
      </p>

      {/* BOTH WAYS FORWARD — equally. */}
      <div style={{ display: 'flex', gap: SPACING.md, marginTop: SPACING.md }}>
        <button
          type="button"
          data-testid="surplus-accept"
          onClick={onAccept}
          style={{
            minHeight: `${TOUCH_TARGET_PX}px`,
            fontSize: `${MIN_LABEL_PX}px`,
          }}
        >
          {t('weigh.surplus.accept')}
        </button>
        <button
          type="button"
          data-testid="surplus-decline"
          onClick={onDecline}
          style={{
            minHeight: `${TOUCH_TARGET_PX}px`,
            fontSize: `${MIN_LABEL_PX}px`,
          }}
        >
          {t('weigh.surplus.decline')}
        </button>
      </div>
    </section>
  );
}
