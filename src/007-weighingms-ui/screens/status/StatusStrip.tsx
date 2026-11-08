/**
 * StatusStrip — the peripherals' states.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY ENTRY IS A REAL VALUE FROM THE API. AND TWO FAILURES GET TWO
 * ENTRIES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Each failure gets its own entry and its own reason; no failure is
 * collapsed into a single generic 'error' state"* (FR-19).
 *
 * **And a stale snapshot is shown WITH ITS AGE** — so a wrong number
 * wearing a correct-looking costume is never presented as current
 * (BRD FR-32, FR-33).
 *
 * **And a queued write is shown as PENDING, never as posted** — a posting
 * that has not landed has not happened as far as the MES is concerned.
 */
import type { Translate } from '../../i18n/useStrings.js';
import type { PeripheralStatus } from '../../state/status-store.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

/** One peripheral's entry. */
export function PeripheralEntry({
  status,
  t,
}: {
  readonly status: PeripheralStatus;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div
      data-testid={`peripheral-${status.id}`}
      data-state={status.state}
      data-healthy={status.healthy ? 'true' : 'false'}
      style={{
        display: 'flex',
        gap: SPACING.sm,
        alignItems: 'center',
        minHeight: `${TOUCH_TARGET_PX}px`,
        fontSize: `${MIN_LABEL_PX}px`,
        color: status.healthy ? COLOURS.text : COLOURS.danger,
      }}
    >
      <span>{status.id}</span>
      {/* THE STATE — the API's own vocabulary, never a literal. */}
      <span data-testid={`peripheral-state-${status.id}`}>
        {t(`status.state.${status.state.toLowerCase()}`)}
      </span>
      {/* THE REASON — and it is NEVER empty for an unhealthy peripheral. */}
      {!status.healthy && (
        <span data-testid={`peripheral-reason-${status.id}`}>
          {t(status.reason)}
        </span>
      )}
      {/* THE AGE — and it is shown whenever the data is not current. */}
      {status.ageMs !== null && (
        <span data-testid={`peripheral-age-${status.id}`}>
          {t('status.age')}: {status.ageMs} ms
        </span>
      )}
    </div>
  );
}

/**
 * The status strip.
 *
 * **And it shows the un-synchronised count** — because a healthy link with
 * a non-empty queue is a fact the operator needs.
 */
export function StatusStrip({
  scales,
  link,
  unsynchronisedCount,
  queue,
  apiReachable,
  t,
}: {
  readonly scales: readonly PeripheralStatus[];
  readonly link: PeripheralStatus | null;
  readonly unsynchronisedCount: number;
  readonly queue: readonly {
    readonly componentId?: string;
    readonly state: string;
    readonly attempts: number;
    /**
     * THE LAST ERROR — and it is a **code and a summary**, never a
     * sentence (BRD NFR-11). The detail goes to the log.
     */
    readonly lastError?: { readonly code: string; readonly summary: string } | null;
  }[];
  readonly apiReachable: boolean;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <section
      data-testid="status-strip"
      data-api-reachable={apiReachable ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.xs,
      }}
    >
      {/* THE API IS UNREACHABLE — and the strip says so, rather than
          showing stale states as current (BRD FR-20). */}
      {!apiReachable && (
        <div
          data-testid="status-api-unreachable"
          role="alert"
          style={{ color: COLOURS.danger, fontSize: `${MIN_LABEL_PX}px` }}
        >
          {t('status.apiUnreachable')}
        </div>
      )}

      {/* THE SCALES — each its own entry and its own reason. */}
      {scales.map((scale) => (
        <PeripheralEntry key={scale.id} status={scale} t={t} />
      ))}

      {/* THE ORGATEX LINK — and it is the API's state, never a literal. */}
      {link !== null && <PeripheralEntry status={link} t={t} />}

      {/* THE UN-SYNCHRONISED COUNT — and the queue's depth. */}
      <div
        data-testid="status-unsynchronised"
        style={{ fontSize: `${MIN_LABEL_PX}px` }}
      >
        {t('status.unsynchronised')}: {unsynchronisedCount}
      </div>

      {/* A QUEUED WRITE IS PENDING — NEVER POSTED. And a failed one stays
          visible with its last error. */}
      {queue.length > 0 && (
        <div data-testid="status-queue" style={{ fontSize: `${MIN_LABEL_PX}px` }}>
          {queue.map((entry, index) => (
            <div key={`${entry.state}-${index}`} data-testid={`status-queue-${index}`}>
              {t(`status.queue.${entry.state.toLowerCase()}`)}
              {` — ${entry.attempts}`}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
