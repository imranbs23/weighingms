import type React from 'react';
/**
 * App — the terminal: the top bar, the view, the status strip.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE APP IS A RENDERER. THE WORKFLOW FOLLOWS THE API.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The three views are the prototype's — Select batch, Weigh, Confirm &
 * print. **Which view is shown follows the API**: on sign-in the session's
 * state decides (an unfinished batch is resumed, a completed one reviewed),
 * and after that every move is triggered by an API success — a selection
 * accepted, a session started, a batch completed (bolt 029).
 */
import { useEffect } from 'react';
import { BatchQueueScreen } from '../screens/batch-queue/BatchQueueScreen.js';
import { WeighScreen } from '../screens/weigh/WeighScreen.js';
import { CompletionScreen } from '../screens/completion/CompletionScreen.js';
import { StatusStrip } from '../screens/status/StatusStrip.js';
import { SignInScreen } from '../screens/identity/SignInScreen.js';
import { TOP_BAR_KEYS, TopBar } from '../screens/chrome/TopBar.js';
import {
  OPERATOR_BAR_KEYS,
  OperatorBar,
} from '../screens/identity/OperatorBar.js';
import { useStrings } from '../i18n/useStrings.js';
import { useStatusStore } from '../state/status-store.js';
import { useIdentityStore } from '../state/identity-store.js';
import { useWorkflowStore } from '../state/workflow-store.js';
import { useQueueStore, visibleBatches } from '../state/queue-store.js';

/** The status strip's locale keys. */
export const STATUS_KEYS = [
  'status.age',
  'status.unsynchronised',
  'status.apiUnreachable',
  'status.locale',
  'status.state.ready',
  'status.state.connected',
  'status.state.disconnected',
  'status.state.expired',
  'status.state.linked',
  'status.state.degraded',
  'status.state.offline',
  'status.state.unavailable',
  'status.state.unknown',
  'status.scale.ready',
  'status.scale.connected',
  'status.scale.disconnected',
  'status.scale.expired',
  'status.link.linked',
  'status.link.degraded',
  'status.link.offline',
  'status.peripheral.disconnected',
  'status.peripheral.unavailable',
  'status.peripheral.unknown',
  'status.queue.queued',
  'status.queue.pending',
  'status.queue.failed',
] as const;

/** How often the strip re-reads the peripherals — it is LIVE. */
export const STATUS_REFRESH_MS = 3000;

export function App(): React.JSX.Element {
  const t = useStrings(STATUS_KEYS);
  const barT = useStrings([...OPERATOR_BAR_KEYS, ...TOP_BAR_KEYS]);

  // THE IDENTITY — and the app is GATED on it. Every endpoint the client
  // calls requires an operator session, so a terminal with nobody signed
  // in has nothing to show but the sign-in screen.
  const identity = useIdentityStore((s) => s.state);
  const refreshIdentity = useIdentityStore((s) => s.refresh);
  const signOut = useIdentityStore((s) => s.signOut);

  const scales = useStatusStore((s) => s.scales);
  const link = useStatusStore((s) => s.link);
  const scanner = useStatusStore((s) => s.scanner);
  const printer = useStatusStore((s) => s.printer);
  const unsynchronisedCount = useStatusStore((s) => s.unsynchronisedCount);
  const queue = useStatusStore((s) => s.queue);
  const apiReachable = useStatusStore((s) => s.apiReachable);
  const loadStatus = useStatusStore((s) => s.load);

  const view = useWorkflowStore((s) => s.view);
  const batchId = useWorkflowStore((s) => s.batchId);
  const decide = useWorkflowStore((s) => s.decide);
  const queueState = useQueueStore((s) => s.state);

  useEffect(() => {
    // WHO IS SIGNED IN — the token is in memory, so the client asks.
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    // The strip is read only once there is a session — its reads are
    // guarded, and "unreachable" is the wrong diagnosis for "nobody is
    // signed in". And it is re-read, so a scale that drops shows.
    if (identity.kind !== 'SIGNED_IN') return;
    void loadStatus();
    const timer = setInterval(() => {
      void loadStatus();
    }, STATUS_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [identity.kind, loadStatus]);

  useEffect(() => {
    // THE VIEW ON SIGN-IN — the session's state decides it.
    if (identity.kind !== 'SIGNED_IN') return;
    void decide();
  }, [identity.kind, decide]);

  if (identity.kind !== 'SIGNED_IN') {
    return <SignInScreen />;
  }

  // THE CRUMB — the open batch's order and machine, from the queue's row.
  const row =
    batchId === null
      ? undefined
      : visibleBatches(queueState).find((batch) => batch.batchId === batchId);
  const crumb =
    batchId === null || view === 'QUEUE'
      ? null
      : {
          batchId,
          orderRef: row?.orderRef ?? null,
          machineRef: row?.machineRef ?? null,
        };

  return (
    <div className="screen">
      <TopBar crumb={crumb} t={barT}>
        {/* THE OPERATOR'S CHIP — persistent, so the person at the
            terminal is always visible (FR-18). */}
        <OperatorBar
          operator={identity.operator}
          t={barT}
          onSignOut={() => {
            void signOut();
          }}
        />
      </TopBar>

      <div className="view">
        {view === 'COMPLETE' && batchId !== null ? (
          <CompletionScreen batchId={batchId} />
        ) : view === 'WEIGH' && batchId !== null ? (
          <WeighScreen batchId={batchId} />
        ) : (
          <BatchQueueScreen />
        )}
      </div>

      {/* THE STATUS STRIP — persistent, so a printer that is out of paper
          is visible BEFORE a batch is completed (BRD IR-16). */}
      <StatusStrip
        scales={scales}
        link={link}
        scanner={scanner}
        printer={printer}
        unsynchronisedCount={unsynchronisedCount}
        queue={queue}
        apiReachable={apiReachable}
        t={t}
      />
    </div>
  );
}
