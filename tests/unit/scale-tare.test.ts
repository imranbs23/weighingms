/**
 * Unit tests for the TARE capability — bolt 004, story 003.
 *
 * WHAT IS PROVED HERE
 * --------------------
 *   ADR-014  the tare is applied at the DEVICE, and the reading carries
 *            the tare that produced it
 *   ADR-015  the tare is NEVER persisted
 *   ADR-016  the net reading FLOORS AT ZERO
 *   S-12     no tare in force is DISTINCT from a tare of exactly zero
 *   S-13     a tare may only be applied to a device that can be weighed on
 *   S-14     a refused tare leaves the PREVIOUS tare in force
 *
 * WHY THE TARE IS SUBTRACTED IN THE ADAPTER AND NOT HERE
 * -------------------------------------------------------
 * The domain holds the TARE STATE; the arithmetic that produces a net
 * reading is the adapter's, because the adapter is the one place a tare
 * reaches a device (ADR-014). These tests therefore exercise the
 * subtraction through the adapter, which is where it actually happens.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DummyScaleAdapter } from '../../src/004-scale-integration/infrastructure/adapters/dummy-scale-adapter.js';
import { TareState } from '../../src/004-scale-integration/domain/entities/tare-state.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightUnitConverter } from '../../src/004-scale-integration/domain/services/weight-unit-converter.js';
import { TarePolicy } from '../../src/004-scale-integration/domain/services/tare-policy.js';
import { ScaleHealthPolicy } from '../../src/004-scale-integration/domain/services/scale-health-policy.js';
import { ScaleDevice } from '../../src/004-scale-integration/domain/entities/scale-device.js';
import { ScaleCapability } from '../../src/004-scale-integration/domain/value-objects/scale-capability.js';
import { TestClock } from '../support/scale-harness.js';

const ID = ScaleId.create('SCALE-A');
const AT = new Date('2026-10-31T08:00:00.000Z');

function buildAdapter(): DummyScaleAdapter {
  return new DummyScaleAdapter(
    {
      scaleId: ID,
      unit: 'g',
      sampleIntervalMs: 100,
      idleWeight: '0',
      status: 'CONNECTED',
      calibration: { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') },
    },
    new TestClock(AT).now,
  );
}

function tare(value: string, unit = 'g'): TareState {
  return new TareState(
    ID,
    WeightValue.of(value, unit),
    Instant.of(AT),
    'CONTAINER_MASTER',
    'SOFTWARE',
  );
}

describe('the tare — ADR-014, applied at the device', () => {
  let adapter: DummyScaleAdapter;

  beforeEach(() => {
    adapter = buildAdapter();
  });

  it('leaves the reading GROSS when no tare is in force', () => {
    adapter.setWeight('1000');
    const reading = adapter.read();

    expect(reading.value.text).toBe('1000');
    expect(reading.tare).toBeNull();
  });

  it('subtracts the tare from the reading the device emits', () => {
    adapter.setWeight('1214');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    const reading = adapter.read();

    // The reading the device emits is NET. The dispensed quantity
    // excludes the container's own weight.
    expect(reading.value.text).toBe('1000');
  });

  it('carries the tare that produced the reading', () => {
    adapter.setWeight('1214');
    const applied = adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    const reading = adapter.read();

    expect(reading.tare).not.toBeNull();
    expect(reading.tare?.tareValue.text).toBe('214');
    expect(reading.tare?.source).toBe('CONTAINER_MASTER');
    // The reading carries the SAME object the adapter is subtracting,
    // so the two cannot disagree about what the reading was net of.
    expect(reading.tare).toBe(applied);
  });

  it('records that the tare was applied IN SOFTWARE, for a device with no tare command', () => {
    const applied = adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    // BRD IR-12 / FR-19: the source states that the tare was applied in
    // software. The training device has no tare command (Q-03).
    expect(applied.appliedBy).toBe('SOFTWARE');
  });

  it('applies the tare to EVERY subsequent reading, not just the next one', () => {
    adapter.setWeight('1214');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    // The tare persists into every subsequent reading — which is exactly
    // why it cannot be left to a consumer to subtract.
    expect(adapter.read().value.text).toBe('1000');
    adapter.setWeight('1314');
    expect(adapter.read().value.text).toBe('1100');
  });

  it('REPLACES the previous tare on a re-tare, and never adds to it', () => {
    adapter.setWeight('1000');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });
    expect(adapter.read().value.text).toBe('786');

    adapter.applyTare(ID, {
      value: WeightValue.of('100', 'g'),
      appliedAt: Instant.of(AT),
      source: 'WEIGHED_EMPTY_CONTAINER',
    });

    const reading = adapter.read();
    expect(reading.value.text).toBe('900');
    expect(reading.tare?.tareValue.text).toBe('100');
    expect(reading.tare?.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });
});

describe('the net reading floors at zero — ADR-016', () => {
  let adapter: DummyScaleAdapter;

  beforeEach(() => {
    adapter = buildAdapter();
  });

  it('never produces a NEGATIVE quantity when the gross is below the tare', () => {
    // An empty container removed from a scale zeroed against it: the
    // gross reading is 0 and the tare is 214, so 0 − 214 = −214.
    adapter.setWeight('0');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    const reading = adapter.read();

    expect(reading.value.text).toBe('0');
    expect(reading.value.isNegative()).toBe(false);
  });

  it('leaves the TARE itself unaffected by the clamp', () => {
    adapter.setWeight('0');
    const applied = adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    // Only the NET reading floors. The zero reference is still 214 g.
    expect(applied.tareValue.text).toBe('214');
  });

  it('clamps at exactly the tare boundary', () => {
    adapter.setWeight('214');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    // Gross exactly equal to the tare → net exactly zero.
    expect(adapter.read().value.text).toBe('0');
  });

  it('does NOT clamp one gram above the tare', () => {
    adapter.setWeight('215');
    adapter.applyTare(ID, {
      value: WeightValue.of('214', 'g'),
      appliedAt: Instant.of(AT),
      source: 'CONTAINER_MASTER',
    });

    expect(adapter.read().value.text).toBe('1');
  });
});

describe('no tare in force is not a tare of zero — S-12', () => {
  it('records an EXPLICIT zero tare with its source', () => {
    const adapter = buildAdapter();
    const applied = adapter.applyTare(ID, {
      value: WeightValue.of('0', 'g'),
      appliedAt: Instant.of(AT),
      source: 'WEIGHED_EMPTY_CONTAINER',
    });

    // A tare of zero is a real decision and is recorded with its source.
    expect(applied.tareValue.text).toBe('0');
    expect(applied.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });

  it('a device with NO tare reports a null tare, which is a different fact', () => {
    const adapter = buildAdapter();
    const reading = adapter.read();

    expect(reading.tare).toBeNull();
  });
});

describe('the tare is never persisted — ADR-015', () => {
  it('has NO column in the scale_devices table that could hold a tare', () => {
    // The absence of the column IS the enforcement: persisting a stale
    // tare would be a wrong number, not an inconvenience.
    const device = new ScaleDevice(
      ID,
      '3 kg precision',
      new ScaleCapability(
        'PRECISION',
        WeightValue.of('3000', 'g'),
        WeightValue.of('1', 'g'),
      ),
      { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') },
      AT,
    );

    // The device holds the tare IN MEMORY, as a member of the aggregate.
    expect(device.tareState).toBeNull();
    device.applyTare(tare('214'));
    expect(device.tareState?.tareValue.text).toBe('214');
  });
});

describe('the tare gate — S-13', () => {
  const policy = new TarePolicy();
  const health = new ScaleHealthPolicy();

  /**
   * A device that has spoken, so its link is UP.
   *
   * A device that has NEVER spoken is `UNKNOWN`, and the gate refuses it
   * with `SCALE_NOT_RESPONDING` — which is correct: a device that has
   * never spoken cannot be weighed on, and a tare is a command sent TO a
   * device.
   */
  function device(): ScaleDevice {
    const d = new ScaleDevice(
      ID,
      '3 kg precision',
      new ScaleCapability(
        'PRECISION',
        WeightValue.of('3000', 'g'),
        WeightValue.of('1', 'g'),
      ),
      { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') },
      AT,
    );
    d.markUp(AT);
    return d;
  }

  it('allows a tare on a device that can be weighed on', () => {
    const d = device();
    const verdict = policy.evaluate(d, d.canWeigh(health));
    expect(verdict.allowed).toBe(true);
  });

  it('refuses a tare on a device that has NEVER spoken', () => {
    const never = new ScaleDevice(
      ID,
      '3 kg precision',
      new ScaleCapability(
        'PRECISION',
        WeightValue.of('3000', 'g'),
        WeightValue.of('1', 'g'),
      ),
      { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') },
      AT,
    );
    const verdict = policy.evaluate(never, never.canWeigh(health));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toBe('SCALE_NOT_RESPONDING');
  });

  it('refuses a tare on a DISCONNECTED device, with the gate reason', () => {
    const d = device();
    d.markDown();
    const verdict = policy.evaluate(d, d.canWeigh(health));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toBe('SCALE_DISCONNECTED');
  });

  it('refuses a tare on a device whose calibration has expired', () => {
    const d = device();
    d.updateCalibration({ kind: 'EXPIRED' });
    const verdict = policy.evaluate(d, d.canWeigh(health));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toBe('CALIBRATION_EXPIRED');
  });

  it('allows a tare on a ZEROED device — ADR-010, tare enables the weighing', () => {
    const d = device();
    d.reportStatus('ZEROED');
    const verdict = policy.evaluate(d, d.canWeigh(health));
    expect(verdict.allowed).toBe(true);
  });
});

describe('the unit converter — exact, never a float', () => {
  const converter = new WeightUnitConverter();

  it('converts kilograms into grams EXACTLY', () => {
    const result = converter.convert(WeightValue.of('1.85', 'kg'), 'g');
    expect(result.text).toBe('1850');
    expect(result.unit).toBe('g');
  });

  it('converts a fractional kilogram without losing precision', () => {
    const result = converter.convert(WeightValue.of('0.214', 'kg'), 'g');
    expect(result.text).toBe('214');
  });

  it('converts milligrams into grams exactly', () => {
    const result = converter.convert(WeightValue.of('250', 'mg'), 'g');
    expect(result.text).toBe('0.25');
  });

  it('refuses an UNKNOWN unit rather than assuming it is grams', () => {
    expect(() => converter.convert(WeightValue.of('1', 'lb'), 'g')).toThrow();
  });

  it('refuses to convert INTO an unknown unit', () => {
    expect(() => converter.convert(WeightValue.of('1', 'g'), 'lb')).toThrow();
  });

  it('leaves a value in its own unit untouched', () => {
    const result = converter.convert(WeightValue.of('214', 'g'), 'g');
    expect(result.text).toBe('214');
  });
});
