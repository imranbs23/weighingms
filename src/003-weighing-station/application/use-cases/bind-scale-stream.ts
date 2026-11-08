/**
 * BindScaleStream — bind the session to the device's readings.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SESSION IS THE SUBSCRIBER. ONE SUBSCRIPTION PER BOUND SCALE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The weight arrives by **push** — NFR-01 budgets 100 ms for transport,
 * and polling would spend that budget on request overhead and could not
 * distinguish a disconnected indicator from a stationary weight.
 *
 * So the session **subscribes** when a component is bound to a scale, and
 * **unsubscribes** when the binding moves. One subscription per bound
 * scale — a second subscription to the same device would deliver the same
 * reading twice, and the second copy would be discarded as out of order.
 *
 * AND THE DISCONNECTION COMES THROUGH THE SAME SUBSCRIPTION
 * -------------------------------------------------------
 * There is **one** detector of a disconnection in the product — unit
 * `004`'s watchdog — and the session learns of it through the same stream it
 * learns weights from. A second watchdog here would be a second answer to
 * a question unit `004` already answers.
 */
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleStreamPort } from '../../domain/ports/weighing-station-ports.js';
import type { WeighingSessionRepository } from '../../domain/ports/weighing-station-ports.js';

export interface BindScaleStreamOptions {
  /** The stream — unit 004's fanout. */
  readonly stream: ScaleStreamPort;
  /** Where the session is recorded. */
  readonly sessions: WeighingSessionRepository;
}

export class BindScaleStream {
  constructor(private readonly options: BindScaleStreamOptions) {}

  /**
   * Bind the session to a device's readings.
   *
   * @param scaleId The device the session is bound to.
   * @param onReading The session accepted or discarded the reading.
   * @param onStatus The device's link state changed.
   */
  bind(
    scaleId: ScaleId,
    onReading: (reading: {
      readonly value: import('../../../004-scale-integration/domain/value-objects/weight-value.js').WeightValue;
      readonly stable: boolean;
      readonly sequence: import('../../../004-scale-integration/domain/value-objects/reading-sequence.js').ReadingSequence;
    }) => void,
    onStatus: (status: 'CONNECTED' | 'DISCONNECTED') => void,
  ): () => void {
    return this.options.stream.subscribe(scaleId, onReading, onStatus);
  }
}
