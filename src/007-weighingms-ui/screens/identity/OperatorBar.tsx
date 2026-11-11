/**
 * OperatorBar — the signed-in operator's chip.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CHIP SHOWS THE API's IDENTITY. AND IT IS THE ONLY PLACE THE
 * OPERATOR'S NAME APPEARS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"the signed-in operator chip in the top bar"* (unit 008, FR-18) — and
 * the prototype drew it as `Operator R. Karim · Shift A`.
 *
 * **So the chip is a RENDERER**: the name and the role are the API's, and
 * **the client carries no operator name of its own** — a hard-coded name in
 * the chrome would put the wrong person on every weighing record.
 *
 * **And the shift is NOT rendered** — the prototype's `Shift A` is the
 * prototype's own invention, and the API does not report a shift. A chip
 * that showed a shift the API never sent would be a number wearing a
 * correct-looking costume.
 */
import type { Translate } from '../../i18n/useStrings.js';
import type { OperatorReport } from '../../api/endpoints.js';
import { MIN_LABEL_PX, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

/** Every locale key the operator bar uses. */
export const OPERATOR_BAR_KEYS = [
  'identity.bar.operator',
  'identity.bar.signOut',
] as const;

export function OperatorBar({
  operator,
  t,
  onSignOut,
}: {
  readonly operator: OperatorReport;
  readonly t: Translate;
  readonly onSignOut: () => void;
}): React.JSX.Element {
  return (
    <div
      className="op-chip"
      data-testid="operator-bar"
      data-operator-id={operator.operatorId}
      data-role={operator.role}
    >
      <span className="dot" />
      {t('identity.bar.operator')}
      {/* THE IDENTITY — the API's, both fields. */}
      <b data-testid="operator-bar-name">{operator.displayName}</b>
      <span data-testid="operator-bar-role">{operator.role}</span>

      <button
        type="button"
        data-testid="operator-sign-out"
        onClick={onSignOut}
        style={{
          minHeight: `${TOUCH_TARGET_PX}px`,
          fontSize: `${MIN_LABEL_PX * 0.75}px`,
        }}
      >
        {t('identity.bar.signOut')}
      </button>
    </div>
  );
}
