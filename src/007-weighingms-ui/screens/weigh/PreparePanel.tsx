/**
 * PreparePanel — the lot and the container, before the pour (bolt 031).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR GIVES A VALUE. THE STATION DECIDES WHAT IT MEANS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * One field each. A barcode wedge ends its code with Enter, so Enter sends
 * the value as a SCAN (`code`); the button sends it as KEYED (`lotNumber`,
 * `containerId`). The method is derived from the request's shape on the
 * server, never asserted (ADR-030).
 *
 * The client validates nothing and computes no tare: an empty lot, an
 * unknown container or a refused tare is the server's answer, shown as a
 * locale message.
 *
 * Prompted, not required (bolt 031, option A): confirm does not wait for
 * it, and the record carries whatever was captured in this session.
 */
import { useState } from 'react';
import type { Translate } from '../../i18n/useStrings.js';
import { MIN_LABEL_PX, SPACING, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

export type PrepareInput =
  | { readonly kind: 'SCAN'; readonly value: string }
  | { readonly kind: 'KEYED'; readonly value: string };

export function PreparePanel({
  needsLot,
  needsContainer,
  busy,
  t,
  onLot,
  onContainer,
}: {
  /** No lot captured for the active component in this session. */
  readonly needsLot: boolean;
  /** No container assigned for the active component in this session. */
  readonly needsContainer: boolean;
  readonly busy: boolean;
  readonly t: Translate;
  readonly onLot: (input: PrepareInput) => void;
  readonly onContainer: (input: PrepareInput) => void;
}): React.JSX.Element | null {
  const [lot, setLot] = useState('');
  const [container, setContainer] = useState('');

  if (!needsLot && !needsContainer) return null;

  const row = (
    id: 'lot' | 'container',
    value: string,
    setValue: (next: string) => void,
    submit: (input: PrepareInput) => void,
  ): React.JSX.Element => (
    <div className="prepare-row" style={{ display: 'flex', gap: SPACING.sm, alignItems: 'center' }}>
      <label style={{ flex: 1 }}>
        <span className="k-label">{t(`weigh.prepare.${id}`)}</span>
        <input
          data-testid={`prepare-${id}-input`}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // A barcode wedge ends its code with Enter.
            if (event.key === 'Enter') submit({ kind: 'SCAN', value });
          }}
          style={{ width: '100%', minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        />
      </label>
      <button
        type="button"
        className="key"
        data-testid={`prepare-${id}-submit`}
        disabled={busy}
        onClick={() => submit({ kind: 'KEYED', value })}
        style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px`, alignSelf: 'flex-end' }}
      >
        {t(`weigh.prepare.${id}Submit`)}
      </button>
    </div>
  );

  return (
    <section className="panel" data-testid="prepare-panel" style={{ padding: SPACING.md }}>
      <p className="k-label" style={{ margin: 0 }}>{t('weigh.prepare.heading')}</p>
      {needsLot && row('lot', lot, setLot, onLot)}
      {needsContainer && row('container', container, setContainer, onContainer)}
    </section>
  );
}
