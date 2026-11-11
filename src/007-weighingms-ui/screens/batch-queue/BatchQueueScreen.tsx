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
 * An accepted selection opens the batch for weighing (the workflow store);
 * a batch that cannot be opened says why, here, on the queue.
 *
 * **AND NO OPERATOR-FACING LITERAL IS HERE.** Every string is a locale key.
 */
import { useEffect, useState } from 'react';
import { useStrings } from '../../i18n/useStrings.js';
import { useQueueStore, visibleBatches } from '../../state/queue-store.js';
import { useWorkflowStore } from '../../state/workflow-store.js';
import { QueueHeader, QueueRow } from './QueueRow.js';
import {
  MIN_LABEL_PX,
  QUEUE_KEYS,
  SPACING,
  TOUCH_TARGET_PX,
} from './tokens.js';

export function BatchQueueScreen(): React.JSX.Element {
  const t = useStrings(QUEUE_KEYS);
  const state = useQueueStore((s) => s.state);
  const refusal = useQueueStore((s) => s.refusal);
  const load = useQueueStore((s) => s.load);
  const select = useQueueStore((s) => s.selectByTouch);
  const clearRefusal = useQueueStore((s) => s.clearRefusal);

  // WHY THE BATCH COULD NOT BE OPENED — the workflow's, after a selection
  // the queue accepted (another batch in progress, no scale can weigh it).
  const workflowRefusal = useWorkflowStore((s) => s.refusal);
  const opening = useWorkflowStore((s) => s.busy);
  const clearWorkflowRefusal = useWorkflowStore((s) => s.clearRefusal);

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

  const submitScan = (): void => {
    void scan(code);
    setCode('');
  };

  return (
    <main
      className="queue"
      data-testid="batch-queue-screen"
      data-opening={opening ? 'true' : 'false'}
      style={{ fontSize: `${MIN_LABEL_PX}px` }}
    >
      {/* THE SCAN PROMPT — the prototype's: scan the batch card, or touch a
          row. The scan and the touch are the SAME action: the server
          derives the method from the body's shape. */}
      <div className="scan-prompt">
        <span className="beam" aria-hidden="true" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs }}>
          <span className="big">{t('queue.scan.prompt')}</span>
          <span className="sm">{t('queue.scan.orTouch')}</span>
        </div>
        <span className="spacer" />
        <input
          data-testid="queue-scan-input"
          aria-label={t('queue.scan.prompt')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            // A barcode wedge ends its code with Enter.
            if (event.key === 'Enter') submitScan();
          }}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        />
        <button
          type="button"
          className="key"
          data-testid="queue-scan-submit"
          onClick={submitScan}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        >
          {t('queue.row.select')}
        </button>
      </div>

      {(refusal !== null || workflowRefusal !== null) && (
        <div className="alert" data-testid="queue-refusal" role="alert">
          <span>
            {refusal !== null
              ? t(`queue.refusal.${refusal.toLowerCase()}`)
              : t(workflowRefusal ?? '')}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="key ghost"
            onClick={() => {
              clearRefusal();
              clearWorkflowRefusal();
            }}
            style={{ minHeight: `${TOUCH_TARGET_PX}px` }}
          >
            {t('queue.refusal.dismiss')}
          </button>
        </div>
      )}

      {/* THE RECEIPT TIME — a SERVER value, displayed as received. And it is
          shown even when the queue is EMPTY, because it tells the operator
          how old the data is. */}
      {receiptTime !== null && (
        <p data-testid="queue-last-received" className="k-label" style={{ margin: 0 }}>
          {t('queue.lastReceived')} {receiptTime}
        </p>
      )}

      {state.kind === 'DEGRADED' && (
        <section className="alert" data-testid="queue-degraded" role="alert">
          <h2 style={{ margin: 0 }}>{t('queue.degraded.title')}</h2>
          {/* THE STATED REASON — the server's code. */}
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
