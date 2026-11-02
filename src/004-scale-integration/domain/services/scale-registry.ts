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
import { TarePolicy } from './tare-policy.js';
import { WeightUnitConverter } from './weight-unit-converter.js';
import { ScaleSelectionRule } from './scale-selection-rule.js';
import { ComponentId } from '../value-objects/component-id.js';
import { WeightValue } from '../value-objects/weight-value.js';
import type { ScaleClass } from '../value-objects/scale-capability.js';
import type { TareSource } from '../value-objects/tare-source.js';
import type { TareApplication } from '../value-objects/tare-application.js';
import type { ScaleSelectionOutcome } from '../value-objects/scale-selection-outcome.js';
import type { ScaleEvent } from '../events/scale-events.js';
import type { WatchdogScheduler } from '../ports/watchdog-scheduler.js';
import type { ScaleDeviceRepository } from '../ports/scale-device-repository.js';
import type { DeviceLinkHistoryRepository } from '../ports/device-link-history-repository.js';
import type { ScaleAdapter } from '../ports/scale-adapter.js';

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
  /**
   * The adapters, for the TARE operation.
   *
   * Separate from the training-control map above, because this one is
   * the product's real seam: the tare command reaches the device
   * through here (ADR-014). The registry asks the adapter to apply the
   * tare and the adapter reports which mechanism it used.
   */
  readonly scaleAdapters?: Map<string, ScaleAdapter> | undefined;
  /**
   * The selection rule's threshold.
   *
   * `null` until FCI answers `Q-04` (ADR-019). The rule works fully
   * without it, because the capacity constraint alone decides every
   * case the story names.
   */
  readonly selectionThreshold?: WeightValue | null;
}

export class ScaleRegistry {
  private readonly devices = new Map<string, ScaleDevice>();
  private readonly acceptance = new ReadingAcceptancePolicy();
  private readonly health = new ScaleHealthPolicy();
  private readonly tarePolicy = new TarePolicy();
  private readonly converter = new WeightUnitConverter();
  private readonly selection: ScaleSelectionRule;

  /** The open disconnection per device, if any. */
  private readonly openGaps = new Map<string, DisconnectionStarted>();

  constructor(private readonly options: ScaleRegistryOptions) {
    this.selection = new ScaleSelectionRule({
      threshold: options.selectionThreshold ?? null,
    });
  }

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

  /**
   * Apply a tare to a device.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE ORDER OF THE STEPS MATTERS
   * ══════════════════════════════════════════════════════════════════
   *
   *   1. the gate — may this device be weighed on at all? (S-13)
   *   2. convert the tare into the DEVICE's unit, exactly (BRD NFR-16)
   *   3. the adapter applies it — the ONE place a tare reaches a device
   *   4. the device's state reflects it — the ONE place it changes
   *
   * A REFUSAL CHANGES NOTHING (S-14). The previous tare remains in
   * force, and the outcome says so. A device whose zero reference was
   * silently dropped would report a container's full weight as the
   * dispensed quantity — a plausible wrong number with no error.
   *
   * The conversion happens HERE, in the domain, rather than in the
   * adapter: the adapter is handed a value already in the device's own
   * unit, so that there is exactly one place a conversion happens and
   * the adapter never has to guess what unit it was given.
   */
  applyTare(
    scaleId: ScaleId,
    tareValue: WeightValue,
    source: TareSource,
  ): TareApplication {
    const device = this.devices.get(scaleId.value);
    if (device === undefined) {
      return { kind: 'REFUSED', reason: 'SCALE_NOT_RESPONDING' };
    }

    // 1. THE ADAPTER, and the device's proof that it is there.
    //
    //    A tare is a command sent TO a device, and a device that has
    //    never spoken cannot be commanded. So the adapter is asked for
    //    one reading, which is ingested through the NORMAL path — which
    //    brings the link UP and makes the gate's verdict meaningful.
    //
    //    Asking for a reading rather than trusting the device's stored
    //    status is deliberate: the link state is the system's own
    //    evidence that the device is there, not the device's word about
    //    itself (S-5).
    const adapter = this.options.scaleAdapters?.get(scaleId.value);
    if (adapter === undefined) {
      this.emit({
        type: 'TARE_REFUSED',
        scaleId: device.id,
        reason: 'SCALE_NOT_RESPONDING',
        at: this.options.clock(),
        previousTareRetained: true,
      });
      return { kind: 'REFUSED', reason: 'SCALE_NOT_RESPONDING' };
    }

    const proof = adapter.readOnce(device.id);
    if (proof === null) {
      // The device produced nothing — it is not there. That is the same
      // distinction the stream makes (S-1): absent, never a zero.
      this.emit({
        type: 'TARE_REFUSED',
        scaleId: device.id,
        reason: 'SCALE_DISCONNECTED',
        at: this.options.clock(),
        previousTareRetained: true,
      });
      return { kind: 'REFUSED', reason: 'SCALE_DISCONNECTED' };
    }

    this.ingestReading(device.id, proof);

    // 2. THE GATE. The same gate the weighing uses, so a tare is
    //    refused for exactly the reasons a weighing is refused.
    const verdict = device.canWeigh(this.health);
    const tareVerdict = this.tarePolicy.evaluate(device, verdict);
    if (!tareVerdict.allowed) {
      this.emit({
        type: 'TARE_REFUSED',
        scaleId: device.id,
        reason: tareVerdict.reason ?? 'SCALE_NOT_RESPONDING',
        at: this.options.clock(),
        previousTareRetained: true,
      });
      return { kind: 'REFUSED', reason: tareVerdict.reason ?? 'SCALE_NOT_RESPONDING' };
    }

    // 3. CONVERT into the device's own unit, exactly.
    const deviceUnit = device.capability.capacity.unit;
    const inDeviceUnit = this.converter.convert(tareValue, deviceUnit);

    const state = adapter.applyTare(device.id, {
      value: inDeviceUnit,
      appliedAt: Instant.of(this.options.clock()),
      source,
    });

    // 4. THE DEVICE. The one place the tare state changes. The adapter
    //    returned the state it applied, so the device's state and the
    //    adapter's subtraction are the same object rather than two
    //    independently built copies that could disagree.
    device.applyTare(state);

    this.emit({
      type: 'TARE_APPLIED',
      scaleId: device.id,
      tare: state,
    });

    return { kind: 'APPLIED', state };
  }

  /** The tare in force on a device, or null when none is. */
  tareOf(scaleId: ScaleId): ScaleDevice['tareState'] {
    return this.devices.get(scaleId.value)?.tareState ?? null;
  }

  /**
   * Select the device for a component.
   *
   * The decision and its record — nothing more. It does NOT bind the
   * session, does NOT reset the weight and does NOT touch either device:
   * a selection is a DECISION, not a connection switch (S-16).
   *
   * The "no device can weigh this" outcome is NOT an error (ADR-018). It
   * is a successful answer to a well-formed question, and it carries
   * the target and the maximum available capacity so the caller can say
   * why.
   */
  selectScale(
    componentId: ComponentId,
    target: WeightValue,
    demandedClass: ScaleClass,
  ): ScaleSelectionOutcome {
    const devices = this.list().map((device) => ({
      scaleId: device.id,
      scaleClass: device.capability.scaleClass,
      capacity: device.capability.capacity,
    }));

    const outcome = this.selection.select(
      target,
      demandedClass,
      devices,
      componentId,
      Instant.of(this.options.clock()),
    );

    if (outcome.kind === 'SELECTED') {
      this.emit({ type: 'SCALE_SELECTED', selection: outcome.selection });
      return outcome;
    }

    this.emit({
      type: 'SCALE_SELECTION_REFUSED',
      componentId,
      target: outcome.target,
      maximumCapacity: outcome.maximumCapacity,
      demandedClass: outcome.demandedClass,
      at: this.options.clock(),
    });
    return outcome;
  }

  /** The selection threshold currently configured, or null (ADR-019). */
  get selectionThreshold(): WeightValue | null {
    return this.selection.threshold;
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
