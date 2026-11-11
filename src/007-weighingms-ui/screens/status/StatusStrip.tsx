/**
 * The status strip — the prototype's `.strip`, at the foot of the screen.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY ENTRY IS A REAL VALUE FROM THE API. TWO FAILURES, TWO ENTRIES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scales, the scanner, the printer and the OrgaTEX link each get their
 * own entry, with their own state and — when unhealthy — their own reason.
 * The prototype's hard-coded OrgaTEX link literal is the API's link
 * state here (BRD IR-18). The locale and the clock are the client's own (story
 * 005: the clock is "a client concern").
 */
import { useEffect, useState } from 'react';
import type { Translate } from '../../i18n/useStrings.js';
import type { PeripheralStatus } from '../../state/status-store.js';
import { TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

/** How often the clock ticks. */
export const CLOCK_TICK_MS = 1000;

export function PeripheralEntry({
  status,
  t,
}: {
  readonly status: PeripheralStatus;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div
      className="stat"
      data-testid={`peripheral-${status.id}`}
      data-state={status.state}
      data-healthy={status.healthy ? 'true' : 'false'}
      style={{ minHeight: `${TOUCH_TARGET_PX}px` }}
    >
      <span className="dot" />
      {/* THE DEVICE — its own label when it has one ("3 kg precision"). */}
      <span>{status.label ?? status.id}</span>
      {' · '}
      {/* THE STATE — the API's own vocabulary, never a literal. */}
      <span data-testid={`peripheral-state-${status.id}`}>
        {t(`status.state.${status.state.toLowerCase()}`)}
      </span>
      {/* THE REASON — and it is NEVER empty for an unhealthy peripheral. */}
      {!status.healthy && (
        <>
          {' — '}
          <span data-testid={`peripheral-reason-${status.id}`}>
            {t(status.reason)}
          </span>
        </>
      )}
      {/* THE AGE — shown whenever the data is not current. */}
      {status.ageMs !== null && (
        <span data-testid={`peripheral-age-${status.id}`}>
          {' · '}
          {t('status.age')} {status.ageMs} ms
        </span>
      )}
    </div>
  );
}

export function StatusStrip({
  scales,
  link,
  scanner = null,
  printer = null,
  unsynchronisedCount,
  queue,
  apiReachable,
  t,
}: {
  readonly scales: readonly PeripheralStatus[];
  readonly link: PeripheralStatus | null;
  readonly scanner?: PeripheralStatus | null;
  readonly printer?: PeripheralStatus | null;
  readonly unsynchronisedCount: number;
  readonly queue: readonly {
    readonly componentId?: string;
    readonly state: string;
    readonly attempts: number;
    readonly lastError?: { readonly code: string; readonly summary: string } | null;
  }[];
  readonly apiReachable: boolean;
  readonly t: Translate;
}): React.JSX.Element {
  const clock = useClock();

  return (
    <footer
      className="strip"
      data-testid="status-strip"
      data-api-reachable={apiReachable ? 'true' : 'false'}
    >
      {/* THE API IS UNREACHABLE — and the strip says so, rather than
          showing stale states as current (BRD FR-20). */}
      {!apiReachable && (
        <div
          className="stat"
          data-testid="status-api-unreachable"
          data-healthy="false"
          role="alert"
        >
          <span className="dot" />
          {t('status.apiUnreachable')}
        </div>
      )}

      {/* THE SCALES — each its own entry and its own reason. */}
      {scales.map((scale) => (
        <PeripheralEntry key={scale.id} status={scale} t={t} />
      ))}

      {scanner !== null && <PeripheralEntry status={scanner} t={t} />}
      {printer !== null && <PeripheralEntry status={printer} t={t} />}

      {/* THE ORGATEX LINK — the API's state, never a literal. */}
      {link !== null && <PeripheralEntry status={link} t={t} />}

      {/* THE UN-SYNCHRONISED COUNT — and the queue's depth. */}
      <div
        className="stat"
        data-testid="status-unsynchronised"
        data-healthy={unsynchronisedCount === 0 ? 'true' : 'false'}
      >
        {t('status.unsynchronised')} {unsynchronisedCount}
      </div>

      {/* A QUEUED WRITE IS PENDING — NEVER POSTED. And a failed one stays
          visible with its last error. */}
      {queue.length > 0 && (
        <div className="stat" data-testid="status-queue">
          {queue.map((entry, index) => (
            <span key={`${entry.state}-${index}`} data-testid={`status-queue-${index}`}>
              {t(`status.queue.${entry.state.toLowerCase()}`)}
              {` — ${entry.attempts}`}
            </span>
          ))}
        </div>
      )}

      <span className="spacer" />

      <div className="stat" data-testid="status-locale">
        {t('status.locale')}
      </div>
      <div className="stat" data-testid="status-clock">
        {clock}
      </div>
    </footer>
  );
}

/** The terminal's clock — HH:MM:SS, ticking. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return now.toTimeString().slice(0, 8);
}
