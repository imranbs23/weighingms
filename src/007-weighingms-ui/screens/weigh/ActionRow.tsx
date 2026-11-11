/**
 * The action row — the prototype's keys: OK · Confirm (F1), Re-tare (F2),
 * Quit (F4) and Supervisor override.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A KEY PRESS AND A TAP ARE ONE CODE PATH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story: *"The action row's function keys (F1 confirm, F2 re-tare, F4
 * quit) and their touch equivalents dispatch the same actions"* (BRD FR-19,
 * FR-22). So the keys are bound to the SAME handlers the buttons call
 * (`useFunctionKeys`), and a disabled button's key does nothing either.
 *
 * And the confirm's REASON is always beside it — never an unexplained
 * disabled button.
 */
import { useEffect } from 'react';
import type { Translate } from '../../i18n/useStrings.js';
import type { ConfirmAction } from '../../state/action-store.js';
import { MIN_LABEL_PX, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

/** The keys, by the action they dispatch. */
export const FUNCTION_KEYS = {
  confirm: 'F1',
  reTare: 'F2',
  nextBatch: 'F3',
  quit: 'F4',
} as const;

/**
 * Bind function keys to handlers — `null` for a key whose action is not
 * available right now, so a disabled button's key is disabled too.
 */
export function useFunctionKeys(
  bindings: Readonly<Record<string, (() => void) | null>>,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const handler = bindings[event.key];
      if (handler === undefined) return;
      // The browser's own F-key meanings (help, reload) never fire here.
      event.preventDefault();
      handler?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [bindings]);
}

export function ActionRow({
  confirm,
  busy,
  canReTare,
  t,
  onConfirm,
  onReTare,
  onAbandon,
  onOverride,
  canOverride,
}: {
  readonly confirm: ConfirmAction;
  readonly busy: boolean;
  readonly canReTare?: boolean;
  readonly t: Translate;
  readonly onConfirm: () => void;
  readonly onReTare?: () => void;
  readonly onAbandon: () => void;
  readonly onOverride?: () => void;
  /** Whether the supervisor override may be raised — only while OVER. */
  readonly canOverride?: boolean;
}): React.JSX.Element {
  const confirmEnabled = confirm.enabled && !busy;
  const reTareEnabled = canReTare === true && !busy && onReTare !== undefined;

  useFunctionKeys({
    [FUNCTION_KEYS.confirm]: confirmEnabled ? onConfirm : null,
    [FUNCTION_KEYS.reTare]: reTareEnabled ? (onReTare ?? null) : null,
    [FUNCTION_KEYS.quit]: busy ? null : onAbandon,
  });

  const keyStyle = {
    minHeight: `${Math.max(TOUCH_TARGET_PX, 64)}px`,
    fontSize: `${MIN_LABEL_PX}px`,
  };

  return (
    <section className="actions" data-testid="action-row">
      <button
        type="button"
        className="key ok"
        data-testid="confirm-action"
        data-enabled={confirm.enabled ? 'true' : 'false'}
        disabled={!confirmEnabled}
        onClick={onConfirm}
        style={keyStyle}
      >
        {t('weigh.confirm.caption')}
        <span className="fn">{FUNCTION_KEYS.confirm}</span>
      </button>

      {onReTare !== undefined && (
        <button
          type="button"
          className="key"
          data-testid="retare-action"
          disabled={!reTareEnabled}
          onClick={onReTare}
          style={keyStyle}
        >
          {t('weigh.retare.caption')}
          <span className="fn">{FUNCTION_KEYS.reTare}</span>
        </button>
      )}

      <button
        type="button"
        className="key ghost"
        data-testid="abandon-action"
        disabled={busy}
        onClick={onAbandon}
        style={keyStyle}
      >
        {t('weigh.abandon.caption')}
        <span className="fn">{FUNCTION_KEYS.quit}</span>
      </button>

      {onOverride !== undefined && (
        <button
          type="button"
          className="key ghost"
          data-testid="override-action"
          disabled={busy || canOverride !== true}
          onClick={onOverride}
          style={{ ...keyStyle, marginLeft: 'auto' }}
        >
          {t('weigh.escalation.heading')}
        </button>
      )}

      {/* THE REASON — beside the button, and NEVER empty. */}
      <span className="confirm-reason" data-testid="confirm-reason">
        {t(confirm.reason)}
      </span>
    </section>
  );
}
