/**
 * ScaleStreamAdapter — the session's subscription to the device.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SHIM OVER UNIT 004's STREAM SERVICE. AND THE DISCONNECTION COMES
 * THROUGH THE SAME SUBSCRIPTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `004`'s `ScaleStreamService` is the fanout from the registry to its
 * consumers, and it already distinguishes two facts:
 *
 * - a **reading** — a live weight, already net of the tare (ADR-014);
 * - a **status** — the link state changed, with the reason the gate uses
 *   (ADR-011).
 *
 * **Both come through this one subscription**, so the session learns about
 * a disconnection from the **same place** it learns about a weight — and
 * there is **one** detector of the disconnection in the product (unit
 * `004`'s watchdog). The session does not run a second watchdog, because a
 * second watchdog would be a second answer to a question unit `004` already
 * answers (ADR-028's rule, applied to the link).
 */
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { ScaleStreamService } from '../../../004-scale-integration/domain/services/scale-stream-service.js';
import type { ScaleRegistry } from '../../../004-scale-integration/domain/services/scale-registry.js';
import type { ScaleAdapter } from '../../../004-scale-integration/domain/ports/scale-adapter.js';
import { DummyScaleAdapter } from '../../../004-scale-integration/infrastructure/adapters/dummy-scale-adapter.js';
import { WeightUnitConverter } from '../../../004-scale-integration/domain/services/weight-unit-converter.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleStreamPort } from '../../domain/ports/weighing-station-ports.js';

export class ScaleStreamAdapter implements ScaleStreamPort {
  constructor(
    private readonly streams: ScaleStreamService,
    private readonly registry: ScaleRegistry,
    /**
     * The device adapters, by device id.
     *
     * The adapter's stream is **shared** — one pump per device feeds the
     * registry, and the registry broadcasts to every subscriber. So the
     * pump must be started when the **first** subscriber attaches, and a
     * second subscriber must NOT start a second one — or the device would
     * emit two interleaved sequences and every reading would look
     * out of order.
     */
    private readonly adapters: Map<string, ScaleAdapter>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  subscribe(
    scaleId: ScaleId,
    onReading: (reading: {
      readonly value: import('../../../004-scale-integration/domain/value-objects/weight-value.js').WeightValue;
      readonly stable: boolean;
      readonly sequence: import('../../../004-scale-integration/domain/value-objects/reading-sequence.js').ReadingSequence;
    }) => void,
    onStatus: (status: 'CONNECTED' | 'DISCONNECTED') => void,
  ): () => void {
    const unsubscribe = this.streams.subscribe(scaleId, (message) => {
      if (message.kind === 'READING') {
        onReading({
          value: message.reading.value,
          stable: message.reading.stable,
          sequence: message.reading.sequence,
        });
        return;
      }

      // A status frame. The DISCONNECTED one is what blocks the weighing;
      // the CONNECTED one is what re-establishes it.
      onStatus(
        message.status === 'DISCONNECTED' ? 'DISCONNECTED' : 'CONNECTED',
      );
    });

    // THE PUMP. Without it the device never speaks, and the session never
    // receives a reading. It is started here — at the first subscriber —
    // and it is SHARED: a second subscriber joins the same pump rather
    // than starting a second one.
    void this.pump(scaleId);

    return unsubscribe;
  }

  /**
   * Resume a device's sequence counter from a durable floor.
   *
   * **The training device's counter is in memory**, so it restarts at 1
   * while the session's floor is durable — and every reading would then be
   * rejected as out of order. So the counter is resumed here.
   *
   * A real indicator needs none of this: it owns its counter and kept
   * counting while the station was away.
   */
  resumeCounter(scaleId: ScaleId, floor: number): void {
    const adapter = this.adapters.get(scaleId.value);
    if (!(adapter instanceof DummyScaleAdapter)) return;
    adapter.resumeFrom(floor);
  }

  /** The training device's platform is emptied for the next component. */
  clearForNextComponent(scaleId: ScaleId): void {
    const adapter = this.adapters.get(scaleId.value);
    if (!(adapter instanceof DummyScaleAdapter)) return;
    adapter.clearForNextComponent();
  }

  /**
   * Start the training device's dispense ramp.
   *
   * The target and the half-width are converted into the DEVICE's unit —
   * a kilogram target on a gram scale — exactly, by unit 004's converter.
   */
  trainingDispense(
    scaleId: ScaleId,
    target: WeightValue,
    halfWidth: WeightValue,
    landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
  ): boolean {
    const adapter = this.adapters.get(scaleId.value);
    const device = this.registry.get(scaleId);
    if (!(adapter instanceof DummyScaleAdapter) || device === null) {
      return false;
    }

    const unit = device.capability.capacity.unit;
    const converter = new WeightUnitConverter();
    adapter.startDispense(
      converter.convert(target, unit),
      converter.convert(halfWidth, unit),
      landing,
    );
    return true;
  }

  /**
   * Pump the device's readings into the registry.
   *
   * The pump **stops when the last subscriber leaves** — otherwise the
   * device would keep producing readings for a device nobody is watching,
   * forever, which is a leak a long-running station would accumulate.
   */
  private async pump(scaleId: ScaleId): Promise<void> {
    const adapter = this.adapters.get(scaleId.value);
    if (!(adapter instanceof DummyScaleAdapter)) return;
    if (adapter.isPumping()) return;

    adapter.startPumping();

    try {
      for await (const reading of adapter.openStream(scaleId)) {
        // Stop when nobody is watching. The check is AFTER the yield, so
        // the first reading is always delivered to the subscriber that
        // started the pump.
        if (this.streams.subscriberCount(scaleId) === 0) {
          adapter.stop();
          return;
        }

        const accepted = this.registry.ingestReading(scaleId, reading);
        if (accepted) {
          this.streams.publishReading(scaleId, reading);
        }
      }
    } catch {
      // The adapter's stream ended. Nothing to do — the device is simply
      // silent, and the watchdog will notice.
    }
  }
}
