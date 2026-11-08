/**
 * The weight stream — the SSE subscription.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE NEWEST READING WINS — BY SEQUENCE, NOT BY ARRIVAL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge case: *"Readings arrive out of order → the client
 * renders the newest reading by its sequence or timestamp, **not the last
 * one received**."*
 *
 * **And the stream's own shape is the server's** — `event: reading` and
 * `event: status`, with a `: heartbeat` comment every 15 s. The client
 * parses what the server sends; it does not invent a frame.
 */

/** One reading frame, as the server sends it. */
export interface ReadingFrame {
  readonly scaleId: string;
  /** The value — a **JSON STRING** (ADR-008). */
  readonly value: string;
  readonly unit: string;
  readonly stable: boolean;
  readonly sequence: number;
  readonly receivedAt: string;
}

/** One status frame, as the server sends it. */
export interface StatusFrame {
  readonly status: string;
  readonly since: string | null;
  readonly detail: string | null;
}

/** What the stream reports. */
export type StreamMessage =
  | { readonly kind: 'READING'; readonly reading: ReadingFrame }
  | { readonly kind: 'STATUS'; readonly status: StatusFrame };

/** The subscription's handle. */
export interface WeightStream {
  /** Stop the subscription. */
  close: () => void;
}

/**
 * Subscribe to a device's readings.
 *
 * **And it is an `EventSource`** — the server pushes, so the client never
 * polls (NFR-01: the latency budget is 100 ms sampling + 100 ms
 * transport and render, and polling would spend the second on request
 * overhead).
 *
 * @param baseUrl The API's base URL.
 * @param scaleId The device to watch.
 * @param onMessage A reading or a status arrived.
 */
export function subscribeToWeight(
  baseUrl: string,
  scaleId: string,
  onMessage: (message: StreamMessage) => void,
): WeightStream {
  // THE STREAM IS OPTIONAL IN THE ENVIRONMENT.
  //
  // **`EventSource` is not present in every runtime** — a test's DOM does
  // not have one, and a browser without server-sent events does not
  // either. **And a missing stream must not break the view**: the readout
  // shows no value, and the operator sees the empty state (B-1).
  //
  // So the absence is handled, not thrown.
  if (typeof EventSource === 'undefined') {
    return { close: () => undefined };
  }

  const source = new EventSource(
    `${baseUrl}/api/scales/${encodeURIComponent(scaleId)}/weight`,
  );

  source.addEventListener('reading', (event) => {
    const data = (event as MessageEvent<string>).data;
    try {
      onMessage({
        kind: 'READING',
        reading: JSON.parse(data) as ReadingFrame,
      });
    } catch {
      // A frame that is not JSON is dropped — and the client keeps the
      // reading it already has. A malformed frame is not a reason to
      // render a wrong number.
    }
  });

  source.addEventListener('status', (event) => {
    const data = (event as MessageEvent<string>).data;
    try {
      onMessage({
        kind: 'STATUS',
        status: JSON.parse(data) as StatusFrame,
      });
    } catch {
      // As above.
    }
  });

  return {
    close: () => {
      source.close();
    },
  };
}
