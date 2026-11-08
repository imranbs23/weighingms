/**
 * The weight stream's hook — and the RECONNECT.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STREAM IS THE SERVER'S PUSH. THE CLIENT NEVER POLLS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * NFR-01 budgets 100 ms for sampling and 100 ms for transport and render.
 * Polling would spend the second on request overhead, **and** it could not
 * distinguish a disconnected indicator from a stationary weight — and the
 * story requires that distinction.
 *
 * **And the `EventSource` reconnects on its own** — the browser's
 * implementation retries a dropped connection. So the hook's job is to
 * subscribe when the device changes and to unsubscribe when it does not.
 */
import { useEffect } from 'react';
import { API_BASE_URL } from '../api/client.js';
import { subscribeToWeight } from './weight-stream.js';
import { useWeighStore } from '../state/weigh-store.js';

/**
 * Watch a device's readings.
 *
 * @param scaleId The device — and `null` watches nothing.
 */
export function useWeightStream(scaleId: string | null): void {
  const accept = useWeighStore((s) => s.accept);
  const setStatus = useWeighStore((s) => s.setStatus);
  const clear = useWeighStore((s) => s.clear);

  useEffect(() => {
    if (scaleId === null) {
      // No device — and so no reading. The readout shows NO VALUE, never
      // `0.0` (B-1).
      clear();
      return;
    }

    const stream = subscribeToWeight(API_BASE_URL, scaleId, (message) => {
      if (message.kind === 'READING') {
        accept(message.reading);
        return;
      }
      setStatus(message.status);
    });

    return () => {
      stream.close();
    };
  }, [scaleId, accept, setStatus, clear]);
}
