/**
 * EscalationPanel — the supervisor's override.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SUPERVISOR SIGNS OFF AT THE TERMINAL. THE PROMPT STATES THAT A
 * REASON IS REQUIRED. AND IT NEVER OFFERS THE OPERATOR'S OWN CREDENTIALS
 * AS A WAY THROUGH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"The escalation prompt states that a reason is required, and enforces
 * it. The reason field is **mandatory at the request boundary**, not merely
 * required by convention, and the supervisor's authentication is a separate
 * thing from the reason: **neither alone completes the override**."*
 *
 * **The supervisor types a badge, a PIN and a reason — nothing else.** The
 * authorisation id is requested by the terminal from unit `008`, for the
 * escalation's own subject (ADR-047); nobody types it.
 *
 * **And the panel enters an explicit AWAITING-SUPERVISOR state** in which
 * the weighing is **not** confirmed. Once AUTHORISED it says so, and the
 * confirm action is the next step.
 */
import { useEffect, useState } from 'react';
import { formatQuantity } from '../../format/quantity.js';
import type { EscalationReport } from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

export function EscalationPanel({
  escalation,
  awaitingSupervisor,
  failure,
  t,
  onAuthorise,
  onDiscard,
}: {
  readonly escalation: EscalationReport | null;
  /** Whether the request is awaiting a supervisor. */
  readonly awaitingSupervisor: boolean;
  /** The last failure's reason — a locale key. */
  readonly failure: string | null;
  readonly t: Translate;
  readonly onAuthorise: (input: {
    readonly supervisorId: string;
    readonly secret: string;
    readonly reason: string;
  }) => void;
  readonly onDiscard: () => void;
}): React.JSX.Element | null {
  const [supervisorId, setSupervisorId] = useState('');
  const [secret, setSecret] = useState('');
  const [reason, setReason] = useState('');

  // A refusal clears the PIN: it is never left on the screen to retry with.
  useEffect(() => {
    if (failure !== null) setSecret('');
  }, [failure]);

  if (escalation === null) return null;

  const authorised = escalation.state === 'AUTHORISED';

  return (
    <section
      className="panel"
      data-testid="escalation-panel"
      data-state={escalation.state}
      data-awaiting={awaitingSupervisor ? 'true' : 'false'}
      style={{
        border: `1px solid ${authorised ? COLOURS.success : COLOURS.danger}`,
        padding: SPACING.md,
        fontSize: `${MIN_LABEL_PX}px`,
      }}
    >
      <h2>{t('weigh.escalation.heading')}</h2>

      <div data-testid="escalation-amount">
        {t('weigh.escalation.amount')}:{' '}
        {formatQuantity(escalation.surplusAmount, escalation.unit)}{' '}
        {escalation.unit}
      </div>

      {authorised ? (
        // AUTHORISED — by whom, and what happens next.
        <p data-testid="escalation-authorised" style={{ color: COLOURS.success }}>
          {t('weigh.escalation.authorised')} {escalation.supervisorId}
        </p>
      ) : (
        <>
          {/* THE PROMPT — and it STATES that a reason is required. */}
          <p data-testid="escalation-reason-required">
            {t('weigh.escalation.reasonRequired')}
          </p>

          {/* THE AWAITING-SUPERVISOR STATE — and the weighing is NOT
              confirmed while it is open. */}
          {awaitingSupervisor && (
            <p data-testid="escalation-awaiting" style={{ color: COLOURS.warning }}>
              {t('weigh.escalation.awaitingSupervisor')}
            </p>
          )}

          {failure !== null && (
            <p data-testid="escalation-failure" style={{ color: COLOURS.danger }}>
              {t(failure)}
            </p>
          )}

          {/* THE SUPERVISOR'S CREDENTIALS — a DISTINCT supervisor's, never
              the operator's. */}
          <label style={{ display: 'block', marginTop: SPACING.sm }}>
            {t('weigh.escalation.supervisorId')}
            <input
              data-testid="escalation-supervisor-id"
              value={supervisorId}
              onChange={(event) => setSupervisorId(event.target.value)}
              style={{ width: '100%', minHeight: `${TOUCH_TARGET_PX}px` }}
            />
          </label>

          <label style={{ display: 'block' }}>
            {t('weigh.escalation.secret')}
            <input
              type="password"
              data-testid="escalation-secret"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              style={{ width: '100%', minHeight: `${TOUCH_TARGET_PX}px` }}
            />
          </label>

          {/* THE REASON — and it is REQUIRED. */}
          <label style={{ display: 'block' }}>
            {t('weigh.escalation.reason')}
            <input
              data-testid="escalation-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              style={{ width: '100%', minHeight: `${TOUCH_TARGET_PX}px` }}
            />
          </label>

          <div style={{ display: 'flex', gap: SPACING.md, marginTop: SPACING.md }}>
            <button
              type="button"
              data-testid="escalation-authorise"
              // Badge, PIN and reason are all REQUIRED — and the button is
              // disabled without them, so the requirement is visible before
              // the press.
              disabled={
                supervisorId.trim().length === 0 ||
                secret.length === 0 ||
                reason.trim().length === 0
              }
              onClick={() => onAuthorise({ supervisorId, secret, reason })}
              style={{
                minHeight: `${TOUCH_TARGET_PX}px`,
                fontSize: `${MIN_LABEL_PX}px`,
              }}
            >
              {t('weigh.escalation.authorise')}
            </button>

            <button
              type="button"
              data-testid="escalation-discard"
              onClick={onDiscard}
              style={{
                minHeight: `${TOUCH_TARGET_PX}px`,
                fontSize: `${MIN_LABEL_PX}px`,
              }}
            >
              {t('weigh.escalation.discard')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
