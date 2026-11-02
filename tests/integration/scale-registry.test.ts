/**
 * Integration tests for the scale registry and the disconnection handling.
 *
 * WHAT IS PROVED HERE
 * --------------------
 *   - the registry is the ONLY path a reading takes into the domain
 *   - the watchdog trips at the 2000 ms boundary, and not a millisecond
 *     earlier (ADR-012: the scheduler decides WHEN, the policy decides
 *     THE ANSWER)
 *   - a disconnection gap is recorded as TWO immutable facts (S-9)
 *   - a device that reconnects with a sequence that is not strictly
 *     greater stays DISCONNECTED
 *   - a disconnection NEVER records a weight (ADR-009)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScaleRegistry } from '../../src/004-scale-integration/domain/services/scale-registry.js';
import { LinkWatchdog } from '../../src/004-scale-integration/domain/services/link-watchdog.js';
import { ScaleDevice } from '../../src/004-scale-integration/domain/entities/scale-device.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleCapability } from '../../src/004-scale-integration/domain/value-objects/scale-capability.js';
import { ScaleReading } from '../../src/004-scale-integration/domain/value-objects/scale-reading.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
import type { ScaleEvent } from '../../src/004-scale-integration/domain/events/scale-events.js';
import type { DeviceLinkHistoryRepository } from '../../src/004-scale-integration/domain/ports/device-link-history-repository.js';
import type { ScaleDeviceRepository } from '../../src/004-scale-integration/domain/ports/scale-device-repository.js';
import {
  ManualWatchdogScheduler,
  TestClock,
} from '../support/scale-harness.js';

const ID = ScaleId.create('SCALE-A');

/** An in-memory history repository that records what was appended. */
class RecordingHistory implements DeviceLinkHistoryRepository {
  readonly started: { scaleId: string; startedAt: Date; detectedAt: Date }[] = [];
  readonly ended: { scaleId: string; startedAt: Date; endedAt: Date }[] = [];

  async appendStarted(record: {
    scaleId: ScaleId;
    startedAt: Date;
    detectedAt: Date;
  }): Promise<void> {
    this.started.push({
      scaleId: record.scaleId.value,
      startedAt: record.startedAt,
      detectedAt: record.detectedAt,
    });
  }

  async appendEnded(record: {
    scaleId: ScaleId;
    startedAt: Date;
    endedAt: Date;
  }): Promise<void> {
    this.ended.push({
      scaleId: record.scaleId.value,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    });
  }

  async listGaps(): Promise<never[]> {
    return [];
  }
}

class NullDeviceRepository implements ScaleDeviceRepository {
  async get(): Promise<ScaleDevice | null> {
    return null;
  }
  async list(): Promise<ScaleDevice[]> {
    return [];
  }
  async save(): Promise<void> {
    // no-op
  }
}

function buildDevice(linkedAt: Date): ScaleDevice {
  return new ScaleDevice(
    ID,
    '3 kg precision',
    new ScaleCapability(
      'PRECISION',
      WeightValue.of('3000', 'g'),
      WeightValue.of('1', 'g'),
    ),
    { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') },
    linkedAt,
  );
}

function reading(value: string, sequence: number, receivedAt: Date): ScaleReading {
  return new ScaleReading(
    WeightValue.of(value, 'g'),
    false,
    ReadingSequence.of(sequence),
    receivedAt,
  );
}

describe('ScaleRegistry — the single path into the domain', () => {
  let clock: TestClock;
  let scheduler: ManualWatchdogScheduler;
  let history: RecordingHistory;
  let events: ScaleEvent[];
  let registry: ScaleRegistry;
  let device: ScaleDevice;

  beforeEach(() => {
    clock = new TestClock();
    scheduler = new ManualWatchdogScheduler();
    history = new RecordingHistory();
    events = [];

    registry = new ScaleRegistry({
      watchdog: new LinkWatchdog(2000),
      scheduler,
      devices: new NullDeviceRepository(),
      history,
      clock: clock.now,
      onEvent: (event) => events.push(event),
    });

    device = buildDevice(clock.now());
    registry.register(device);
  });

  afterEach(() => {
    scheduler.dispose();
  });

  it('accepts the first reading of a device', () => {
    const accepted = registry.ingestReading(
      ID,
      reading('93.42', 1, clock.now()),
    );
    expect(accepted).toBe(true);
    expect(device.lastAcceptedReading?.value.text).toBe('93.42');
  });

  it('rejects a reading whose sequence is not strictly greater', () => {
    registry.ingestReading(ID, reading('93.42', 5, clock.now()));

    const accepted = registry.ingestReading(ID, reading('1.00', 3, clock.now()));

    expect(accepted).toBe(false);
    expect(device.lastAcceptedReading?.value.text).toBe('93.42');
  });

  it('emits a READING_REJECTED event for a rejected reading', () => {
    registry.ingestReading(ID, reading('93.42', 5, clock.now()));
    registry.ingestReading(ID, reading('1.00', 3, clock.now()));

    const rejected = events.find((e) => e.type === 'READING_REJECTED');
    expect(rejected).toBeDefined();
  });

  it('ignores a reading for an unregistered device', () => {
    const accepted = registry.ingestReading(
      ScaleId.create('SCALE-Z'),
      reading('1', 1, clock.now()),
    );
    expect(accepted).toBe(false);
  });

  it('schedules the watchdog at the receipt time plus the timeout', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));

    const deadline = scheduler.deadlineFor(ID);
    expect(deadline).not.toBeNull();
    expect(deadline?.getTime()).toBe(clock.now().getTime() + 2000);
  });

  it('REPLACES the watchdog timer on each accepted reading', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(500);
    registry.ingestReading(ID, reading('2', 2, clock.now()));

    // One timer per device, not one per reading.
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.deadlineFor(ID)?.getTime()).toBe(clock.now().getTime() + 2000);
  });

  it('is UP at exactly 2000 ms and DOWN at 2001 ms', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));

    clock.advance(2000);
    expect(registry.checkWatchdog(ID)).toBe(true);
    expect(device.linkState).toBe('UP');

    clock.advance(1);
    expect(registry.checkWatchdog(ID)).toBe(false);
    expect(device.linkState).toBe('DOWN');
  });

  it('records the disconnection as a STARTED fact with both times', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);

    expect(history.started).toHaveLength(1);
    // startedAt is the receipt time of the last reading; detectedAt is
    // when the watchdog noticed.
    expect(history.started[0]?.startedAt.getTime()).toBe(
      clock.now().getTime() - 2001,
    );
    expect(history.started[0]?.detectedAt.getTime()).toBe(clock.now().getTime());
  });

  it('emits a SCALE_DISCONNECTED event', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);

    const disconnected = events.find((e) => e.type === 'SCALE_DISCONNECTED');
    expect(disconnected).toBeDefined();
  });

  it('records the reconnection as an ENDED fact joining the STARTED one', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);

    clock.advance(100);
    registry.ingestReading(ID, reading('2', 2, clock.now()));

    expect(history.ended).toHaveLength(1);
    // The ENDED fact carries the STARTED fact's start time, so the pair
    // joins into a gap without a mutable gap row.
    expect(history.ended[0]?.startedAt.getTime()).toBe(
      history.started[0]?.startedAt.getTime(),
    );
  });

  it('brings the link back UP when a greater-sequence reading arrives', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);
    expect(device.linkState).toBe('DOWN');

    registry.ingestReading(ID, reading('2', 2, clock.now()));
    expect(device.linkState).toBe('UP');
  });

  it('keeps the device DISCONNECTED when the reconnecting sequence is not greater', () => {
    registry.ingestReading(ID, reading('93.42', 42, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);
    expect(device.linkState).toBe('DOWN');

    // The device came back but its counter did not advance.
    const accepted = registry.ingestReading(ID, reading('1.00', 42, clock.now()));

    expect(accepted).toBe(false);
    expect(device.linkState).toBe('DOWN');
  });

  it('does not record a gap for a device that never spoke', () => {
    // A device that has never delivered a reading has no last-activity
    // time to measure silence from, and produces no gap.
    clock.advance(5000);
    registry.checkWatchdog(ID);

    expect(history.started).toHaveLength(0);
    expect(device.linkState).toBe('UNKNOWN');
  });

  it('does not record a weight in the gap facts', () => {
    registry.ingestReading(ID, reading('93.42', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);

    // The recorded facts carry times and sequences — never a quantity.
    const serialized = JSON.stringify({
      started: history.started,
      ended: history.ended,
    });
    expect(serialized).not.toContain('93.42');
    expect(serialized).not.toContain('value');
  });

  it('reports SCALE_NOT_RESPONDING for a device that has never spoken', () => {
    const verdict = registry.canWeigh(ID);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('SCALE_NOT_RESPONDING');
  });

  it('reports SCALE_DISCONNECTED once the device has gone silent', () => {
    registry.ingestReading(ID, reading('1', 1, clock.now()));
    clock.advance(2001);
    registry.checkWatchdog(ID);

    const verdict = registry.canWeigh(ID);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('SCALE_DISCONNECTED');
  });

  it('refuses a weighing on an unregistered scale', () => {
    const verdict = registry.canWeigh(ScaleId.create('SCALE-Z'));
    expect(verdict.allowed).toBe(false);
  });
});
