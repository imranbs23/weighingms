/**
 * Unit tests for the scale unit's pure domain.
 *
 * THE PROOF OBLIGATIONS
 * ---------------------
 *   S-1   a missing reading is not a zero
 *   S-2   a missing reading carries a reason
 *   S-3   the sequence is strictly increasing
 *   S-4   the receipt time is stamped on arrival
 *   S-5   the link overrides the device's self-report
 *   S-6   the watchdog measures from the receipt time
 *   S-7   the gate lives in ONE place
 *   S-8   the capacity check uses the device's capacity
 *   S-9   a gap is two immutable facts
 *   S-10  the calibration expiry is enforced
 *
 * EVERY PURE FUNCTION IS TESTED AT ITS BOUNDARY, because the boundaries
 * are where the requirements bite: at exactly 2000 ms the link is still
 * UP; at exactly 2001 ms it is DOWN.
 */
import { describe, it, expect } from 'vitest';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleReading } from '../../src/004-scale-integration/domain/value-objects/scale-reading.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { ScaleDevice } from '../../src/004-scale-integration/domain/entities/scale-device.js';
import { ScaleCapability } from '../../src/004-scale-integration/domain/value-objects/scale-capability.js';
import { LinkWatchdog } from '../../src/004-scale-integration/domain/services/link-watchdog.js';
import { ReadingAcceptancePolicy } from '../../src/004-scale-integration/domain/services/reading-acceptance-policy.js';
import { ScaleHealthPolicy } from '../../src/004-scale-integration/domain/services/scale-health-policy.js';
import { DispenseRamp } from '../../src/004-scale-integration/domain/services/dispense-ramp.js';

const ID = ScaleId.create('SCALE-A');
const AT = new Date('2026-10-30T07:00:00.000Z');

function device(
  calibration: { kind: 'IN_CALIBRATION'; expiresAt: Date } | { kind: 'EXPIRED' } = {
    kind: 'IN_CALIBRATION',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  },
): ScaleDevice {
  return new ScaleDevice(
    ID,
    '3 kg precision',
    new ScaleCapability(
      'PRECISION',
      WeightValue.of('3000', 'g'),
      WeightValue.of('1', 'g'),
    ),
    calibration,
    AT,
  );
}

function reading(
  value: string,
  sequence: number,
  receivedAt: Date = AT,
  stable = false,
): ScaleReading {
  return new ScaleReading(
    WeightValue.of(value, 'g'),
    stable,
    ReadingSequence.of(sequence),
    receivedAt,
  );
}

describe('WeightValue', () => {
  it('rejects a float-shaped string', () => {
    // "1e3" is a float's notation. A quantity that arrived in it was
    // computed in binary floating point somewhere upstream.
    expect(() => WeightValue.of('1e3', 'g')).toThrow();
  });

  it('rejects a value with no unit', () => {
    expect(() => WeightValue.of('93.42', '  ')).toThrow();
  });

  it('rejects a bare leading dot', () => {
    expect(() => WeightValue.of('.5', 'g')).toThrow();
  });

  it('rejects a trailing dot', () => {
    expect(() => WeightValue.of('5.', 'g')).toThrow();
  });

  it('rejects leading zeros', () => {
    expect(() => WeightValue.of('00.5', 'g')).toThrow();
  });

  it('rejects a leading plus sign', () => {
    expect(() => WeightValue.of('+5', 'g')).toThrow();
  });

  it('accepts zero', () => {
    expect(WeightValue.of('0', 'g').isZero()).toBe(true);
  });

  it('accepts a negative weight — a scale can read below zero', () => {
    const value = WeightValue.of('-1.5', 'g');
    expect(value.isNegative()).toBe(true);
  });

  it('PRESERVES trailing zeros — they may be the device resolution', () => {
    expect(WeightValue.of('93.40', 'g').text).toBe('93.40');
  });

  it('compares values with different fractions correctly', () => {
    expect(WeightValue.of('93.4', 'g').compareTo(WeightValue.of('93.40', 'g'))).toBe(0);
    expect(WeightValue.of('93.41', 'g').compareTo(WeightValue.of('93.4', 'g'))).toBe(1);
    expect(WeightValue.of('93.39', 'g').compareTo(WeightValue.of('93.4', 'g'))).toBe(-1);
  });

  it('compares NEGATIVE values correctly', () => {
    expect(WeightValue.of('-1.5', 'g').compareTo(WeightValue.of('-2', 'g'))).toBe(1);
    expect(WeightValue.of('-2', 'g').compareTo(WeightValue.of('-1.5', 'g'))).toBe(-1);
    expect(WeightValue.of('-1.5', 'g').compareTo(WeightValue.of('-1.5', 'g'))).toBe(0);
  });

  it('compares a negative value against zero correctly', () => {
    expect(WeightValue.of('-0.1', 'g').compareTo(WeightValue.of('0', 'g'))).toBe(-1);
  });

  it('REFUSES to compare across units rather than converting', () => {
    expect(() => WeightValue.of('1000', 'g').compareTo(WeightValue.of('1', 'kg'))).toThrow();
  });

  it('serialises as a JSON string, never a number', () => {
    const value = WeightValue.of('93.42', 'g');
    expect(typeof value.toJSON()).toBe('string');
    expect(JSON.stringify({ value: value.toJSON() })).toBe('{"value":"93.42"}');
  });
});

describe('ReadingSequence', () => {
  it('rejects a negative sequence', () => {
    expect(() => ReadingSequence.of(-1)).toThrow();
  });

  it('rejects a non-integer sequence', () => {
    expect(() => ReadingSequence.of(1.5)).toThrow();
  });

  it('compares strictly', () => {
    expect(ReadingSequence.of(2).isGreaterThan(ReadingSequence.of(1))).toBe(true);
    expect(ReadingSequence.of(1).isGreaterThan(ReadingSequence.of(1))).toBe(false);
    expect(ReadingSequence.of(1).isGreaterThan(ReadingSequence.of(2))).toBe(false);
  });
});

describe('S-1 — a missing reading is not a zero', () => {
  it('reports NEVER_READ with no value when the device has never spoken', () => {
    const d = device();
    const snapshot = d.snapshot(AT);

    expect(snapshot.kind).toBe('NONE');
    if (snapshot.kind === 'NONE') {
      expect(snapshot.reason).toBe('NEVER_READ');
      // The absence branch carries NO value at all.
      expect('reading' in snapshot).toBe(false);
    }
  });

  it('reports DISCONNECTED when the device goes silent after speaking', () => {
    const d = device();
    d.acceptReading(reading('93.42', 1), () => true);
    d.markDown();

    const snapshot = d.snapshot(AT);
    expect(snapshot.kind).toBe('NONE');
    if (snapshot.kind === 'NONE') {
      expect(snapshot.reason).toBe('DISCONNECTED');
      expect('reading' in snapshot).toBe(false);
    }
  });

  it('still reports a reading of exactly zero as a READING', () => {
    const d = device();
    d.acceptReading(reading('0', 1), () => true);

    const snapshot = d.snapshot(AT);
    expect(snapshot.kind).toBe('READING');
  });
});

describe('S-3 — the sequence is strictly increasing', () => {
  const policy = new ReadingAcceptancePolicy();

  it('accepts the first reading of a device', () => {
    const verdict = policy.evaluate(reading('1', 1), null);
    expect(verdict.accepted).toBe(true);
  });

  it('accepts a strictly greater sequence', () => {
    const verdict = policy.evaluate(reading('2', 2), ReadingSequence.of(1));
    expect(verdict.accepted).toBe(true);
  });

  it('REJECTS a repeated sequence', () => {
    const verdict = policy.evaluate(reading('2', 1), ReadingSequence.of(1));
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('OUT_OF_ORDER');
  });

  it('REJECTS a lower sequence — the device restarted its counter', () => {
    const verdict = policy.evaluate(reading('2', 1), ReadingSequence.of(42));
    expect(verdict.accepted).toBe(false);
  });

  it('leaves the previous reading in place when a reading is rejected', () => {
    const d = device();
    d.acceptReading(reading('93.42', 5), () => true);

    const accepted = d.acceptReading(reading('1.00', 3), () => false);

    expect(accepted).toBe(false);
    expect(d.lastAcceptedReading?.value.text).toBe('93.42');
    expect(d.lastSequence?.value).toBe(5);
  });
});

describe('S-4 — the receipt time is stamped on arrival', () => {
  it('carries the arrival time, not a device-supplied time', () => {
    const receivedAt = new Date('2026-10-30T07:00:00.123Z');
    const r = reading('1', 1, receivedAt);
    expect(r.receivedAt.getTime()).toBe(receivedAt.getTime());
  });
});

describe('S-5 — the link overrides the device self-report', () => {
  it('publishes DISCONNECTED while the link is down, even if the device says CONNECTED', () => {
    const d = device();
    d.reportStatus('CONNECTED');
    d.acceptReading(reading('1', 1), () => true);
    expect(d.status).toBe('CONNECTED');

    d.markDown();
    expect(d.status).toBe('DISCONNECTED');
    // The device's own report is still available for the evidence.
    expect(d.reportedStatus).toBe('CONNECTED');
  });

  it('publishes DISCONNECTED while the link is UNKNOWN', () => {
    const d = device();
    expect(d.linkState).toBe('UNKNOWN');
    expect(d.status).toBe('DISCONNECTED');
  });
});

describe('S-6 — the watchdog measures from the receipt time', () => {
  const watchdog = new LinkWatchdog(2000);
  const base = Instant.of(new Date('2026-10-30T07:00:00.000Z'));

  it('is UP at exactly the 2000 ms boundary', () => {
    // "Within 2 seconds" has NOT been exceeded at exactly 2000 ms.
    const verdict = watchdog.evaluate(base, base.plus(2000));
    expect(verdict.isUp).toBe(true);
  });

  it('is DOWN at 2001 ms', () => {
    const verdict = watchdog.evaluate(base, base.plus(2001));
    expect(verdict.isUp).toBe(false);
  });

  it('is UP before the boundary', () => {
    expect(watchdog.evaluate(base, base.plus(1999)).isUp).toBe(true);
  });

  it('reports the deadline it used', () => {
    const verdict = watchdog.evaluate(base, base.plus(5000));
    expect(verdict.deadline.epochMillis).toBe(base.epochMillis + 2000);
    expect(verdict.elapsedMs).toBe(5000);
  });

  it('refuses a non-positive timeout', () => {
    expect(() => new LinkWatchdog(0)).toThrow();
    expect(() => new LinkWatchdog(-1)).toThrow();
  });
});

describe('S-7 — the weighing gate', () => {
  const policy = new ScaleHealthPolicy();
  const valid = { kind: 'IN_CALIBRATION', expiresAt: new Date('2027-01-01') } as const;

  it('allows a weighing on a healthy, connected scale', () => {
    const verdict = policy.evaluate('UP', 'CONNECTED', valid);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('refuses with SCALE_DISCONNECTED when the link is DOWN', () => {
    const verdict = policy.evaluate('DOWN', 'CONNECTED', valid);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('SCALE_DISCONNECTED');
  });

  it('refuses with SCALE_NOT_RESPONDING when the link is UNKNOWN', () => {
    // ADR-011: UNKNOWN and DOWN are DIFFERENT facts and say so.
    const verdict = policy.evaluate('UNKNOWN', 'CONNECTED', valid);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('SCALE_NOT_RESPONDING');
  });

  it('refuses with CALIBRATION_EXPIRED when the calibration has expired', () => {
    const verdict = policy.evaluate('UP', 'CONNECTED', { kind: 'EXPIRED' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('CALIBRATION_EXPIRED');
  });

  it('refuses with OVER_CAPACITY', () => {
    const verdict = policy.evaluate('UP', 'OVER_CAPACITY', valid);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('OVER_CAPACITY');
  });

  it('refuses with SCALE_BUSY', () => {
    const verdict = policy.evaluate('UP', 'BUSY', valid);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('SCALE_BUSY');
  });

  it('ALLOWS a ZEROED scale — ADR-010, tare enables the weighing', () => {
    const verdict = policy.evaluate('UP', 'ZEROED', valid);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('names the LINK failure first, not the calibration', () => {
    // A device we cannot reach has a calibration state that is not the
    // fact the operator needs.
    const verdict = policy.evaluate('DOWN', 'CONNECTED', { kind: 'EXPIRED' });
    expect(verdict.reason).toBe('SCALE_DISCONNECTED');
  });

  it('is reachable through the aggregate — the single chokepoint', () => {
    const d = device();
    d.acceptReading(reading('1', 1), () => true);
    expect(d.canWeigh(policy).allowed).toBe(true);

    d.markDown();
    expect(d.canWeigh(policy).allowed).toBe(false);
    expect(d.canWeigh(policy).reason).toBe('SCALE_DISCONNECTED');
  });
});

describe('S-10 — the calibration expiry is enforced', () => {
  it('blocks a weighing on an expired calibration', () => {
    const d = device({ kind: 'EXPIRED' });
    d.acceptReading(reading('1', 1), () => true);

    const verdict = d.canWeigh(new ScaleHealthPolicy());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('CALIBRATION_EXPIRED');
  });
});

describe('DispenseRamp — the prototype formula', () => {
  const ramp = new DispenseRamp();

  it('lands in tolerance at target + 40% of tolerance', () => {
    const landing = ramp.landing(
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'IN_TOLERANCE',
    );
    expect(landing.text).toBe('1004.0000');
  });

  it('lands over tolerance at target + 480% of tolerance', () => {
    const landing = ramp.landing(
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'OVER_TOLERANCE',
    );
    expect(landing.text).toBe('1048.0000');
  });

  it('steps by max(target x 0.004, remaining x 0.055)', () => {
    // target 1000 g, tolerance 10 g, in-tolerance landing 1004 g.
    // step = max(1000 * 0.004, 1004 * 0.055) = max(4, 55.22) = 55.22
    const result = ramp.step(
      WeightValue.of('0', 'g'),
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'IN_TOLERANCE',
    );
    expect(result.value.text).toBe('55.2200');
  });

  it('uses the minimum step rate when the remaining distance is small', () => {
    // Close to the landing, remaining * 0.055 falls below target * 0.004.
    const result = ramp.step(
      WeightValue.of('1003', 'g'),
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'IN_TOLERANCE',
    );
    // remaining = 1, max(4, 0.055) = 4, but clamped to the landing of 1004.
    expect(result.value.text).toBe('1004.0000');
    expect(result.landed).toBe(true);
  });

  it('lands EXACTLY, never past the landing', () => {
    const result = ramp.step(
      WeightValue.of('1003.9', 'g'),
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'IN_TOLERANCE',
    );
    expect(result.value.text).toBe('1004.0000');
    expect(result.landed).toBe(true);
  });

  it('does not move once the landing is reached', () => {
    const result = ramp.step(
      WeightValue.of('1004', 'g'),
      WeightValue.of('1000', 'g'),
      WeightValue.of('10', 'g'),
      'IN_TOLERANCE',
    );
    expect(result.value.text).toBe('1004.0000');
    expect(result.landed).toBe(true);
  });

  it('converges on the landing from a cold start', () => {
    let current = WeightValue.of('0', 'g');
    const target = WeightValue.of('1000', 'g');
    const tolerance = WeightValue.of('10', 'g');

    for (let i = 0; i < 200; i += 1) {
      const result = ramp.step(current, target, tolerance, 'IN_TOLERANCE');
      current = result.value;
      if (result.landed) break;
    }

    expect(current.text).toBe('1004.0000');
  });
});
