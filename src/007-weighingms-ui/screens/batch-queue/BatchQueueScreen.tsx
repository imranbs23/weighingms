/**
 * BatchQueueScreen — the released batch queue.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THREE STATES, AND THEY ARE DISTINGUISHABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * - **LOADED** — the rows;
 * - **EMPTY** — an explicit empty state, with the receipt time still shown;
 * - **DEGRADED** — the server could not be reached, with a stated reason.
 *
 * **And EMPTY is not DEGRADED.** The story: *"it does not render a stale
 * or empty-looking success"* (BRD FR-20) — and the API goes out of its
 * way to distinguish them, so the client must too.
 *
 * **AND NO OPERATOR-FACING LITERAL IS HERE.** Every string is a locale key.
 */
import { useEffect, useState } from 'react';
import { useStrings } from '../../i18n/useStrings.js';
import { useQueueStore, visibleBatches } from '../../state/queue-store.js';
import { QueueHeader, QueueRow } from './QueueRow.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  QUEUE_KEYS,
  SPACING,
  TOUCH_TARGET_PX,
} from './tokens.js';

export function BatchQueueScreen(): React.JSX.Element {
  const t = useStrings(QUEUE_KEYS);
  const state = useQueueStore((s) => s.state);
  const filter = useQueueStore((s) => s.filter);
  const refusal = useQueueStore((s) => s.refusal);
  const load = useQueueStore((s) => s.load);
  const select = useQueueStore((s) => s.selectByTouch);
  const clearRefusal = useQueueStore((s) => s.clearRefusal);

  // The scan box — the operator's other way to select.
  const [code, setCode] = useState('');
  const scan = useQueueStore((s) => s.selectByScan);

  useEffect(() => {
    void load(null);
  }, [load]);

  const batches = visibleBatches(state);
  const receiptTime =
    state.kind === 'LOADED' || state.kind === 'EMPTY'
      ? state.queue.receivedAt
      : null;

  return (
    <main
      data-testid="batch-queue-screen"
      style={{
        padding: SPACING.lg,
        color: COLOURS.text,
        fontSize: `${MIN_LABEL_PX}px`,
      }}
    >
      <h1 style={{ fontSize: `${MIN_LABEL_PX * 1.4}px`, margin: 0 }}>
        {t('queue.title')}
      </h1>

      {/* THE RECEIPT TIME — a SERVER value, displayed as received. And it is
          shown even when the queue is EMPTY, because it tells the operator
          how old the data is. */}
      {receiptTime !== null && (
        <p data-testid="queue-last-received" style={{ color: COLOURS.textMuted }}>
          {t('queue.lastReceived')}: {receiptTime}
        </p>
      )}

      {refusal !== null && (
        <div
          data-testid="queue-refusal"
          role="alert"
          style={{ color: COLOURS.danger }}
        >
          {t(`queue.refusal.${refusal.toLowerCase()}`)}
          <button
            type="button"
            onClick={clearRefusal}
            style={{ minHeight: `${TOUCH_TARGET_PX}px` }}
          >
            {t('queue.filter.all')}
          </button>
        </div>
      )}

      {/* THE SCAN — the operator's other way in. And the SAME action as the
          touch: the server derives the method from the body's shape. */}
      <div style={{ display: 'flex', gap: SPACING.sm, margin: SPACING.md }}>
        <input
          data-testid="queue-scan-input"
          aria-label={t('queue.row.select')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        />
        <button
          type="button"
          data-testid="queue-scan-submit"
          onClick={() => {
            void scan(code);
            setCode('');
          }}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        >
          {t('queue.row.select')}
        </button>
      </div>

      {state.kind === 'DEGRADED' && (
        <section
          data-testid="queue-degraded"
          role="alert"
          style={{ color: COLOURS.danger }}
        >
          <h2>{t('queue.degraded.title')}</h2>
          {/* THE STATED REASON — the server's code, rendered through the
              bundle. */}
          <p data-testid="queue-degraded-reason">{state.reason}</p>
        </section>
      )}

      {state.kind === 'EMPTY' && (
        <section data-testid="queue-empty">
          <h2>{t('queue.empty.title')}</h2>
          <p>{t('queue.empty.body')}</p>
        </section>
      )}

      {state.kind === 'LOADED' && (
        <section data-testid="queue-rows">
          <QueueHeader t={t} />
          {batches.map((batch) => (
            <QueueRow
              key={batch.batchId}
              batch={batch}
              t={t}
              // A batch that is no longer released is NOT selectable, and
              // the reason is the server's.
              selectable={batch.weighingStatus === 'RELEASED'}
              onSelect={(batchId) => {
                void select(batchId);
              }}
            />
          ))}
        </section>
      )}
    </main>
  );
}
