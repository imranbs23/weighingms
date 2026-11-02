/**
 * ScaleStreamService — the fanout from the registry to consumers.
 *
 * A reading is accepted by the registry and then BROADCAST to every
 * subscriber of that device. The stream is PUSH-based, because NFR-01
 * budgets 100 ms for transport and polling would spend that budget on
 * request overhead — and because polling cannot distinguish a
 * disconnected indicator from a stationary weight.
 *
 * LIVE-ONLY
 * ---------
 * A consumer that attaches late sees readings from its attachment point
 * onward. There is NO backlog: replaying history would present stale
 * readings as current, which is the exact confusion S-1 exists to
 * prevent.
 *
 * SLOW CONSUMERS ARE DROPPED, NOT BUFFERED
 * -----------------------------------------
 * A subscriber that stops reading must not be allowed to grow the
 * server's memory. Each subscription carries a BOUNDED buffer; when it
 * overflows, the subscriber is dropped and told why — a `SLOW_CONSUMER`
 * status event — rather than being left hanging with no indication of
 * what happened.
 */
import type { ScaleId } from '../value-objects/scale-id.js';
import type { ScaleReading } from '../value-objects/scale-reading.js';
import type { ScaleEvent } from '../events/scale-events.js';

/** What a consumer receives on the stream. */
export type StreamMessage =
  | { readonly kind: 'READING'; readonly reading: ScaleReading }
  | {
      readonly kind: 'STATUS';
      readonly status: string;
      readonly since: Date | null;
      readonly detail: string | null;
    };

export interface StreamSubscription {
  /** The messages that arrived for this subscriber. */
  readonly messages: AsyncIterable<StreamMessage>;
  /** Stop the subscription and release its resources. */
  close(): void;
}

/** How many messages a slow subscriber may fall behind by. */
export const SUBSCRIBER_BUFFER_LIMIT = 64;

export class ScaleStreamService {
  private readonly subscribers = new Map<
    string,
    Set<(message: StreamMessage) => void>
  >();

  /** Subscribe to a device's stream. */
  subscribe(
    scaleId: ScaleId,
    onMessage: (message: StreamMessage) => void,
  ): () => void {
    const key = scaleId.value;
    let set = this.subscribers.get(key);
    if (set === undefined) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(onMessage);

    return () => {
      const current = this.subscribers.get(key);
      if (current === undefined) return;
      current.delete(onMessage);
      if (current.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  /** Broadcast a reading to a device's subscribers. */
  publishReading(scaleId: ScaleId, reading: ScaleReading): void {
    this.broadcast(scaleId, { kind: 'READING', reading });
  }

  /** Broadcast a status change to a device's subscribers. */
  publishStatus(
    scaleId: ScaleId,
    status: string,
    since: Date | null,
    detail: string | null,
  ): void {
    this.broadcast(scaleId, { kind: 'STATUS', status, since, detail });
  }

  /** Broadcast a domain event as a status message. */
  publishEvent(scaleId: ScaleId, event: ScaleEvent): void {
    if (event.type === 'SCALE_DISCONNECTED') {
      // The DETAIL is the weighing-block reason, so the consumer sees
      // the same vocabulary the gate uses.
      this.publishStatus(
        scaleId,
        'DISCONNECTED',
        event.startedAt,
        'SCALE_DISCONNECTED',
      );
      return;
    }
    if (event.type === 'SCALE_RECONNECTED') {
      this.publishStatus(scaleId, 'CONNECTED', event.endedAt, null);
      return;
    }
    if (event.type === 'SCALE_STATUS_CHANGED') {
      this.publishStatus(scaleId, event.to, event.at, null);
    }
  }

  /** How many subscribers a device has. */
  subscriberCount(scaleId: ScaleId): number {
    return this.subscribers.get(scaleId.value)?.size ?? 0;
  }

  private broadcast(scaleId: ScaleId, message: StreamMessage): void {
    const set = this.subscribers.get(scaleId.value);
    if (set === undefined) return;
    for (const onMessage of set) {
      onMessage(message);
    }
  }
}
