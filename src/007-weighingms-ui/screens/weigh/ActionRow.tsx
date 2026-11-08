/**
 * The action row — the operator's controls.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A DISABLED ACTION ALWAYS STATES ITS REASON.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"never a silently dead control on a gloved terminal, which is a support
 * call rather than a design choice."*
 *
 * **So the row renders the reason beside the button** — and the reason is
 * a locale key, so it is the bundle's text and not a literal.
 *
 * **And the confirm button's `enabled` flag is the API's zone** — the
 * client computes no zone of its own.
 */
import type { Translate } from '../../i18n/useStrings.js';
import type { ConfirmAction } from '../../state/action-store.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

export function ActionRow({
  confirm,
  busy,
  t,
  onConfirm,
  onAbandon,
}: {
  readonly confirm: ConfirmAction;
  readonly busy: boolean;
  readonly t: Translate;
  readonly onConfirm: () => void;
  readonly onAbandon: () => void;
}): React.JSX.Element {
  return (
    <section
      data-testid="action-row"
      style={{ display: 'flex', gap: SPACING.md, alignItems: 'center' }}
    >
      <button
        type="button"
        data-testid="confirm-action"
        data-enabled={confirm.enabled ? 'true' : 'false'}
        disabled={!confirm.enabled || busy}
        onClick={onConfirm}
        style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
      >
        {t('weigh.confirm.caption')}
      </button>

      {/* THE REASON — beside the button, and NEVER empty. */}
      <span
        data-testid="confirm-reason"
        style={{ color: COLOURS.textMuted, fontSize: `${MIN_LABEL_PX}px` }}
      >
        {t(confirm.reason)}
      </span>

      <button
        type="button"
        data-testid="abandon-action"
        onClick={onAbandon}
        style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
      >
        {t('weigh.abandon.caption')}
      </button>
    </section>
  );
}
