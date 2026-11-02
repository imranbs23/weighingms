/**
 * ScaleRegistry — the hub. The ONLY thing that mutates a device.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONLY PLACE A READING ENTERS THE DOMAIN (S-3).
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every reading from every adapter passes through `ingestReading`, and
 * that method is the only path by which a device's last reading changes.
 * The aggregate's invariants cannot be broken by a caller because there
 * is no other caller.
 *
 * It is also the only place the watchdog is scheduled. One timer per
 * device, cancelled and replaced on every accepted reading (ADR-012).
 *
 * THE FLOW
 * --------
 *   DummyScaleAdapter ──readings──▶ ScaleRegistry ──broadcast──▶ subscribers
 *                                        │
 *                                        ▼
 *                                ScaleDevice aggregate
 *                                (the ONLY mutator)
 */
import { ScaleId } from '../value-objects/scale-id.js';
import { ScaleReading } from '../value-objects/scale-reading.js';
import { ScaleDevice } from '../entities/scale-device.js';
import { ScaleHealthPolicy, type WeighingVerdict } from './scale-health-policy.js';
import { LinkWatchdog } from './link-watchdog.js';
import { ReadingAcceptancePolicy } from './reading-acceptance-policy.js';
import { Instant } from '../value-objects/instant.js';
import { DisconnectionStarted } from '../entities/disconnection-started.js';
import { DisconnectionEnded } from '../entities/disconnection-ended.js';
import type { ScaleEvent } from '../events/scale-events.js';
import type { WatchdogScheduler } from '../ports/watchdog-scheduler.js';
import type { ScaleDeviceRepository } from '../ports/scale-device-repository.js';
import type { DeviceLinkHistoryRepository } from '../ports/device-link-history-repository.js';

export interface ScaleRegistryOptions {
  readonly watchdog: LinkWatchdog;
  readonly scheduler: WatchdogScheduler;
  readonly devices: ScaleDeviceRepository;
  readonly history: DeviceLinkHistoryRepository;
  readonly clock: () => Date;
  readonly onEvent?: ((event: ScaleEvent) => void) | undefined;
  /**
   * The adapters, so the training control can silence a device.
   *
   * Optional, because the domain must not depend on a concrete adapter.
   * The registry asks through a structural interface, so the `ScaleAdapter`
   * port itself stays free of training-only methods (ADR-013).
   */
  readonly adapters?: Map<string, { silence?: () => void; unsilence?: () => void }> | undefined;
}

export class ScaleRegistry {
  private readonly devices = new Map<string, ScaleDevice>();
  private readonly acceptance = new ReadingAcceptancePolicy();
  private readonly health = new ScaleHealthPolicy();

  /** The open disconnection per device, if any. */
  private readonly openGaps = new Map<string, DisconnectionStarted>();

  constructor(private readonly options: ScaleRegistryOptions) {}

  /** Register a device. Its link starts UNKNOWN. */
  register(device: ScaleDevice): void {
    this.devices.set(device.id.value, device);
  }

  get(scaleId: ScaleId): ScaleDevice | null {
    return this.devices.get(scaleId.value) ?? null;
  }

  list(): ScaleDevice[] {
    return [...this.devices.values()];
  }

  /**
   * Ingest a reading from an adapter.
   *
   * Returns true when the reading was ACCEPTED. A rejected reading is
   * not applied — the previous reading remains the latest valid one.
   */
  ingestReading(scaleId: ScaleId, reading: ScaleReading): boolean {
    const device = this.devices.get(scaleId.value);
    if (device === undefined) {
      return false;
    }

    const verdict = this.acceptance.evaluate(reading, device.lastSequence);
    if (!verdict.accepted) {
      this.emit({
        type: 'READING_REJECTED',
        scaleId,
        rejectedSequence: reading.sequence,
        lastAcceptedSequence: device.lastSequence,
        at: reading.receivedAt,
      });
      return false;
    }

    // A reading after a disconnection brings the link back — and the gap
    // is recorded as two immutable facts (S-9).
    if (device.linkState === 'DOWN') {
      this.recordGapEnd(device, reading);
    }

    const accepted = device.acceptReading(reading, () => true);
    if (!accepted) {
      return false;
    }

    device.markUp(reading.receivedAt);
    this.scheduleWatchdog(device, reading.receivedAt);
    return true;
  }

  /**
   * Evaluate the watchdog for a device NOW.
   *
   * Called by the scheduler when the deadline arrives. The POLICY decides
   * the answer; the scheduler only decided when to ask (ADR-012).
   */
  checkWatchdog(scaleId: ScaleId): boolean {
    const device = this.devices.get(scaleId.value);
    if (device === undefined) {
      return false;
    }
    const last = device.lastAcceptedReading;
    if (last === null) {
      return false;
    }

    const now = this.options.clock();
    const verdict = this.options.watchdog.evaluate(
      Instant.of(last.receivedAt),
      Instant.of(now),
    );

    if (verdict.isUp) {
      return true;
    }

    if (device.linkState === 'UP') {
      device.markDown();
      // The gap STARTS at the last moment we had evidence of the device
      // — the receipt time of its last accepted reading. That is the
      // conservative bound: we know it was there at that instant, and we
      // know nothing about the instant after.
      //
      // It is NOT the deadline. The deadline is when the watchdog was
      // entitled to declare the device gone, not when it stopped being
      // heard from.
      this.recordGapStart(device, last.receivedAt, now);
    }
    return false;
  }

  /** May a weighing proceed on this device? (S-7) */
  canWeigh(scaleId: ScaleId): WeighingVerdict {
    const device = this.devices.get(scaleId.value);
    if (device === undefined) {
      return { allowed: false, reason: 'SCALE_NOT_RESPONDING' };
    }
    return device.canWeigh(this.health);
  }

  /**
   * Force a device's link state — the TRAINING control.
   *
   * This exists so the disconnection path is demonstrable in a running
   * product rather than only in a test with a fake clock. It is
   * training-only, and it is NOT on the `ScaleAdapter` port, so no
   * production code path can depend on it (ADR-013).
   *
   * ══════════════════════════════════════════════════════════════════
   * FORCING A DISCONNECTION SILENCES THE DEVICE.
   * ══════════════════════════════════════════════════════════════════
   *
   * The link state alone is not enough. If the adapter kept emitting
   * readings, the very next reading would bring the link back UP and
   * the disconnection would last a few milliseconds — the training
   * control would appear not to work, and the watchdog would never trip.
   *
   * So the registry asks its adapter to go silent. The device then
   * produces NOTHING, and the watchdog's deadline passes on its own.
   *
   * Bringing the link back does NOT fabricate a reading. A silenced
   * device comes back when it next speaks (S-1: no reading is ever
   * invented).
   */
  forceLink(scaleId: ScaleId, state: 'CONNECTED' | 'DISCONNECTED'): boolean {
    const device = this.devices.get(scaleId.value);
    if (device === undefined) {
      return false;
    }

    const adapter = this.options.adapters?.get(scaleId.value);
    const silenceable = adapter as { silence?: () => void; unsilence?: () => void } | undefined;

    if (state === 'DISCONNECTED') {
      silenceable?.silence?.();
      if (device.linkState === 'UP') {
        device.markDown();
        const now = this.options.clock();
        // The gap starts at the last moment we had evidence of the
        // device, exactly as the watchdog path does.
        this.recordGapStart(
          device,
          device.lastAcceptedReading?.receivedAt ?? now,
          now,
        );
      }
      return true;
    }

    // Un-silencing does NOT fabricate a reading. The link comes back
    // when the device next speaks.
    silenceable?.unsilence?.();
    return true;
  }

  private scheduleWatchdog(device: ScaleDevice, receivedAt: Date): void {
    const deadline = new Date(
      receivedAt.getTime() + this.options.watchdog.timeout,
    );
    this.options.scheduler.schedule(device.id, deadline, () => {
      this.checkWatchdog(device.id);
    });
  }

  private recordGapStart(
    device: ScaleDevice,
    startedAt: Date,
    detectedAt: Date,
  ): void {
    const record = new DisconnectionStarted(
      device.id,
      startedAt,
      detectedAt,
      device.lastSequence,
      'SILENCE',
    );
    this.openGaps.set(device.id.value, record);
    void this.options.history.appendStarted(record);

    this.emit({
      type: 'SCALE_DISCONNECTED',
      scaleId: device.id,
      startedAt,
      detectedAt,
      lastSequence: device.lastSequence,
    });
  }

  private recordGapEnd(device: ScaleDevice, reading: ScaleReading): void {
    const started = this.openGaps.get(device.id.value);
    if (started === undefined) {
      return;
    }
    this.openGaps.delete(device.id.value);

    const ended = new DisconnectionEnded(
      device.id,
      started.startedAt,
      reading.receivedAt,
      started.detectedAt,
      reading.sequence,
    );
    void this.options.history.appendEnded(ended);

    this.emit({
      type: 'SCALE_RECONNECTED',
      scaleId: device.id,
      startedAt: started.startedAt,
      endedAt: reading.receivedAt,
      detectedAt: started.detectedAt,
      resumedAtSequence: reading.sequence,
    });
  }

  private emit(event: ScaleEvent): void {
    this.options.onEvent?.(event);
  }
}
