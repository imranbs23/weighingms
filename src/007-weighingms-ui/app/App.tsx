import type React from 'react';
/**
 * App — the screen.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE APP IS A RENDERER. IT HAS NO STATE AND NO RULES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Bolt `024` delivered the **first** screen — the batch queue. Bolt
 * `025` adds the weigh view, and the queue screen becomes the screen the
 * operator returns to.
 *
 * **And the screen is decided by the SESSION'S state** — not by the
 * client's own idea of where the operator should be. An active session
 * means the weigh view; a complete one means the queue.
 */
import { useEffect, useState } from 'react';
import { fetchSession } from '../api/endpoints.js';
import { BatchQueueScreen } from '../screens/batch-queue/BatchQueueScreen.js';
import { WeighScreen } from '../screens/weigh/WeighScreen.js';
import { StatusStrip } from '../screens/status/StatusStrip.js';
import { SignInScreen } from '../screens/identity/SignInScreen.js';
import {
  OPERATOR_BAR_KEYS,
  OperatorBar,
} from '../screens/identity/OperatorBar.js';
import { useStrings } from '../i18n/useStrings.js';
import { useStatusStore } from '../state/status-store.js';
import { useIdentityStore } from '../state/identity-store.js';

/** The status strip's locale keys. */
export const STATUS_KEYS = [
  'status.age',
  'status.unsynchronised',
  'status.apiUnreachable',
  'status.state.ready',
  'status.state.connected',
  'status.state.disconnected',
  'status.state.expired',
  'status.state.linked',
  'status.state.degraded',
  'status.state.offline',
  'status.scale.ready',
  'status.scale.connected',
  'status.scale.disconnected',
  'status.scale.expired',
  'status.link.linked',
  'status.link.degraded',
  'status.link.offline',
  'status.queue.queued',
  'status.queue.pending',
  'status.queue.failed',
] as const;

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<'QUEUE' | 'WEIGH'>('QUEUE');
  const t = useStrings(STATUS_KEYS);

  // THE IDENTITY — and the app is GATED on it. Every endpoint the client
  // calls requires an operator session, so a terminal with nobody signed
  // in has nothing to show but the sign-in screen: the alternative is a
  // screen whose every request is refused with a `401` the operator
  // cannot act on.
  const identity = useIdentityStore((s) => s.state);
  const refreshIdentity = useIdentityStore((s) => s.refresh);
  const signOut = useIdentityStore((s) => s.signOut);
  const barT = useStrings(OPERATOR_BAR_KEYS);

  const scales = useStatusStore((s) => s.scales);
  const link = useStatusStore((s) => s.link);
  const unsynchronisedCount = useStatusStore((s) => s.unsynchronisedCount);
  const queue = useStatusStore((s) => s.queue);
  const apiReachable = useStatusStore((s) => s.apiReachable);
  const loadStatus = useStatusStore((s) => s.load);

  useEffect(() => {
    // WHO IS SIGNED IN — and the API's answer decides whether the station
    // is usable. The client does not remember a session across a reload
    // (the token is in memory), so it asks.
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    // The status strip is only read **once there is a session** — the
    // guarded reads it makes would be refused otherwise, and a strip that
    // says "the API is unreachable" when the real answer is "nobody is
    // signed in" is a wrong diagnosis shown to the operator.
    if (identity.kind !== 'SIGNED_IN') return;
    void loadStatus();
  }, [identity.kind, loadStatus]);

  useEffect(() => {
    let cancelled = false;

    const decide = async (): Promise<void> => {
      if (identity.kind !== 'SIGNED_IN') return;

      const result = await fetchSession();
      if (cancelled) return;

      if (result.kind === 'OK' && result.body.session !== null) {
        const active = result.body.session.state !== 'COMPLETE';
        setScreen(active ? 'WEIGH' : 'QUEUE');
      }
    };

    void decide();
    return () => {
      cancelled = true;
    };
  }, [identity.kind]);

  // NOBODY IS SIGNED IN — and the terminal shows the sign-in screen.
  // **And nothing else**, because every other screen depends on a session
  // that does not exist.
  if (identity.kind !== 'SIGNED_IN') {
    return <SignInScreen />;
  }

  return (
    <>
      {/* THE OPERATOR'S CHIP — and it is PERSISTENT, so the person at the
          terminal is always visible (FR-18). */}
      <OperatorBar
        operator={identity.operator}
        t={barT}
        onSignOut={() => {
          void signOut();
        }}
      />

      {/* THE STATUS STRIP — and it is PERSISTENT, so a printer that is out
          of paper is visible BEFORE a batch is completed (BRD IR-16). */}
      <StatusStrip
        scales={scales}
        link={link}
        unsynchronisedCount={unsynchronisedCount}
        queue={queue}
        apiReachable={apiReachable}
        t={t}
      />

      {screen === 'WEIGH' ? <WeighScreen /> : <BatchQueueScreen />}
    </>
  );
}
