/**
 * The weigh view's rules — unit 007, bolt 025.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FORMATTED FROM A FIXED-POINT STRING. AND A SILENT SCALE SHOWS NO
 * VALUE.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatQuantity,
  compareQuantities,
  positionInRange,
  DISPLAY_PRECISION,
} from '../../src/007-weighingms-ui/format/quantity.js';
import {
  displayableReading,
  streamAge,
  useWeighStore,
  STALENESS_THRESHOLD_MS,
} from '../../src/007-weighingms-ui/state/weigh-store.js';
import type { ReadingFrame } from '../../src/007-weighingms-ui/stream/weight-stream.js';

describe('the quantity formatter', () => {
  it('grams are shown to 1 dp', () => {
    expect(formatQuantity('94.2400', 'g')).toBe('94.2');
    expect(DISPLAY_PRECISION['g']).toBe(1);
  });

  it('kilograms are shown to 3 dp', () => {
    expect(formatQuantity('24.0100', 'kg')).toBe('24.010');
    expect(DISPLAY_PRECISION['kg']).toBe(3);
  });

  it('the story’s worked example — the total, formatted', () => {
    // 24.000 kg + 500.0 g = 24.500 kg — and each is formatted on its own.
    expect(formatQuantity('24.0000', 'kg')).toBe('24.000');
    expect(formatQuantity('500.0000', 'g')).toBe('500.0');
  });

  it('is EXACT — never through a float', () => {
    // The float sum of 0.1 and 0.2 is 0.30000000000000004. The
    // fixed-point sum is exact.
    expect(formatQuantity('0.1000', 'g')).toBe('0.1');
    expect(formatQuantity('0.2000', 'g')).toBe('0.2');
    // And a value that a float would round away.
    expect(formatQuantity('0.1500', 'g')).toBe('0.2');
  });

  it('a zero is a zero — the formatter does not hide it', () => {
    // The formatter formats a ZERO. The EMPTY STATE is the readout's
    // concern, not the formatter's — and confusing the two is how a
    // `0.0` fallback creeps in.
    expect(formatQuantity('0.0000', 'g')).toBe('0.0');
  });

  it('compares EXACTLY — a value on the boundary is equal', () => {
    expect(compareQuantities('94.5000', '94.5000')).toBe('EQ');
    expect(compareQuantities('94.2400', '94.5000')).toBe('LT');
    expect(compareQuantities('94.6000', '94.5000')).toBe('GT');
  });

  it('positions a value within a range — and CLAMPS it', () => {
    expect(positionInRange('94.0000', '93.5000', '94.5000')).toBe(50);
    expect(positionInRange('93.0000', '93.5000', '94.5000')).toBe(0);
    expect(positionInRange('95.0000', '93.5000', '94.5000')).toBe(100);
  });
});

describe('the stale reading', () => {
  const reading: ReadingFrame = {
    scaleId: 'SCALE-A',
    value: '94.2400',
    unit: 'g',
    stable: true,
    sequence: 7,
    receivedAt: '2026-11-06T10:00:00.000Z',
  };

  beforeEach(() => {
    useWeighStore.setState({
      reading: null,
      receivedAt: null,
      zone: null,
      linkState: null,
      detail: null,
    });
  });

  it('a FRESH reading is displayable', () => {
    const now = 1_000_000;
    expect(displayableReading(reading, now - 50, now)).not.toBeNull();
  });

  it('a STALE reading shows NO VALUE — never `0.0`', () => {
    const now = 1_000_000;
    // Past the threshold.
    const shown = displayableReading(reading, now - 500, now);
    // **NULL** — and not a zero. A `0.0` fallback would be
    // indistinguishable from a genuinely empty scale (B-1).
    expect(shown).toBeNull();
  });

  it('there is NO reading when none has arrived', () => {
    expect(displayableReading(null, null, 1_000_000)).toBeNull();
  });

  it('the staleness threshold comes from the 200 ms budget', () => {
    expect(STALENESS_THRESHOLD_MS).toBe(200);
  });

  it('the stream’s AGE is exposed — so the operator can see it falling behind', () => {
    const now = 1_000_000;
    expect(streamAge(now - 120, now)).toBe(120);
    expect(streamAge(null, now)).toBeNull();
  });
});

describe('the newest reading wins — by SEQUENCE', () => {
  beforeEach(() => {
    useWeighStore.setState({
      reading: null,
      receivedAt: null,
      zone: null,
      linkState: null,
      detail: null,
    });
  });

  it('an OUT-OF-ORDER arrival does not replace a newer reading', () => {
    const accept = useWeighStore.getState().accept;

    accept({
      scaleId: 'SCALE-A',
      value: '94.2400',
      unit: 'g',
      stable: true,
      sequence: 10,
      receivedAt: '2026-11-06T10:00:00.000Z',
    });
    expect(useWeighStore.getState().reading?.value).toBe('94.2400');

    // An OLDER sequence arrives late — and it must not win.
    accept({
      scaleId: 'SCALE-A',
      value: '90.0000',
      unit: 'g',
      stable: true,
      sequence: 8,
      receivedAt: '2026-11-06T10:00:01.000Z',
    });

    expect(useWeighStore.getState().reading?.value).toBe('94.2400');
    expect(useWeighStore.getState().reading?.sequence).toBe(10);
  });

  it('a NEWER sequence does replace it', () => {
    const accept = useWeighStore.getState().accept;

    accept({
      scaleId: 'SCALE-A',
      value: '94.2400',
      unit: 'g',
      stable: true,
      sequence: 10,
      receivedAt: '2026-11-06T10:00:00.000Z',
    });
    accept({
      scaleId: 'SCALE-A',
      value: '94.3000',
      unit: 'g',
      stable: true,
      sequence: 11,
      receivedAt: '2026-11-06T10:00:01.000Z',
    });

    expect(useWeighStore.getState().reading?.value).toBe('94.3000');
  });
});
