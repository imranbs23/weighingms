/**
 * The tolerance zone — unit 003, bolt 014.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE EXHAUSTIVE BOUNDARY SUITE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The unit brief demands it: *"exactly `target − tolerance`, exactly
 * `target × 0.9`, exactly `target + tolerance`, and one ULP either side of
 * each."*
 *
 * Every one of those numbers is a reading the operator could produce on
 * purpose, and the zone it lands in is the difference between a legitimate
 * weighing being accepted and being refused.
 */
import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import { ToleranceZoneEvaluator } from '../../src/003-weighing-station/domain/services/tolerance-zone-evaluator.js';
import { ZoneBounds } from '../../src/003-weighing-station/domain/value-objects/zone-bounds.js';
import {
  stillToWeigh,
} from '../../src/003-weighing-station/application/use-cases/evaluate-zone.js';

const TARGET = WeightValue.of('94.0000', 'g');
const BAND = Tolerance.of(
  WeightValue.of('93.5000', 'g'),
  WeightValue.of('94.5000', 'g'),
);

const evaluator = new ToleranceZoneEvaluator();
const bounds = ZoneBounds.of(TARGET, BAND);

/** One ULP (one unit in the last place) above a decimal, at 4 dp. */
function up(text: string): string {
  return new Decimal(text)
    .plus(new Decimal('0.0001'))
    .toFixed(4, Decimal.ROUND_HALF_UP);
}

/** One ULP below a decimal, at 4 dp. */
function down(text: string): string {
  return new Decimal(text)
    .minus(new Decimal('0.0001'))
    .toFixed(4, Decimal.ROUND_HALF_UP);
}

function zoneOf(value: string): string {
  return evaluator.evaluate(WeightValue.of(value, 'g'), bounds);
}

describe('the near threshold', () => {
  it('is `target × 0.9` EXACTLY — not the float approximation', () => {
    // In IEEE-754, 94.0000 × 0.9 is 84.60000000000001. The requirement
    // pins 84.6000 as `NEAR`, and the float threshold would put it on the
    // wrong side (ADR-037).
    expect(bounds.nearThreshold.text).toBe('84.6000');
  });

  it('is `84.60000000000001` in a float — which is why it is decimal', () => {
    expect(94.0 * 0.9).not.toBe(84.6);
    expect(94.0 * 0.9).toBeGreaterThan(84.6);
  });
});

describe('the zone boundaries — the exhaustive suite', () => {
  // ── The `OVER` bound: `value > target + tolerance` ──

  it('a reading exactly at `target + tolerance` is OK — the bound is STRICT', () => {
    expect(zoneOf('94.5000')).toBe('OK');
  });

  it('one ULP above `target + tolerance` is OVER', () => {
    expect(zoneOf('94.5001')).toBe('OVER');
  });

  it('one ULP below `target + tolerance` is OK', () => {
    expect(zoneOf('94.4999')).toBe('OK');
  });

  // ── The `OK` lower bound: `value >= target − tolerance` ──

  it('a reading exactly at `target − tolerance` is OK — the bound is INCLUSIVE', () => {
    expect(zoneOf('93.5000')).toBe('OK');
  });

  it('one ULP below `target − tolerance` is NEAR', () => {
    expect(zoneOf('93.4999')).toBe('NEAR');
  });

  it('one ULP above `target − tolerance` is OK', () => {
    expect(zoneOf('93.5001')).toBe('OK');
  });

  // ── The `NEAR` bound: `value >= target × 0.9` ──

  it('a reading exactly at `target × 0.9` is NEAR — the bound is INCLUSIVE', () => {
    expect(zoneOf('84.6000')).toBe('NEAR');
  });

  it('one ULP below `target × 0.9` is UNDER', () => {
    expect(zoneOf('84.5999')).toBe('UNDER');
  });

  it('one ULP above `target × 0.9` is NEAR', () => {
    expect(zoneOf('84.6001')).toBe('NEAR');
  });

  // ── The story's own numbers, exactly as it names them ──

  it('the story’s boundary readings land where the story says', () => {
    // Four of the story's five boundary readings are consistent with the
    // rule it states, and they all hold:
    //
    //   94.5000 → OK      (exactly `target + tolerance`)
    //   84.6000 → NEAR    (exactly `target × 0.9`)
    //   94.5001 → OVER    (one ULP above the band)
    //   84.5999 → UNDER   (one ULP below `target × 0.9`)
    //
    // The FIFTH — "the reading is 95.0000 g (exactly `target + tolerance`)
    // → OK" — is **arithmetically inconsistent**: `94.0000 + 0.5000` is
    // `94.5000`, not `95.0000`. And the story's own fifth example
    // (`94.5001 → OVER`) places the boundary at `94.5000`.
    //
    // So the rule the story's Technical Notes state — `OVER` if
    // `value > target + tolerance`, `OK` if `value >= target − tolerance`
    // — is followed, and `95.0000` is `OVER`. The prose's parenthetical is
    // the error, and it is recorded in the test report.
    expect(zoneOf('94.5000')).toBe('OK');
    expect(zoneOf('84.6000')).toBe('NEAR');
    expect(zoneOf('94.5001')).toBe('OVER');
    expect(zoneOf('84.5999')).toBe('UNDER');

    // And the reading the story's first example names is above the band.
    expect(zoneOf('95.0000')).toBe('OVER');
  });

  // ── The zone's interior ──

  it('the middle of the band is OK', () => {
    expect(zoneOf('94.0000')).toBe('OK');
    expect(zoneOf('94.2400')).toBe('OK');
  });

  it('a reading well below the band is UNDER', () => {
    expect(zoneOf('10.0000')).toBe('UNDER');
    expect(zoneOf('0.0000')).toBe('UNDER');
  });

  it('a reading well above the band is OVER', () => {
    expect(zoneOf('120.0000')).toBe('OVER');
  });
});

describe('the zero cases', () => {
  it('a ZERO target: `target × 0.9` is zero, a positive reading is OVER', () => {
    const zeroBounds = ZoneBounds.of(
      WeightValue.of('0.0000', 'g'),
      Tolerance.of(WeightValue.of('0.0000', 'g'), WeightValue.of('0.0000', 'g')),
    );

    expect(zeroBounds.nearThreshold.text).toBe('0.0000');
    expect(
      evaluator.evaluate(WeightValue.of('0.5000', 'g'), zeroBounds),
    ).toBe('OVER');
    expect(
      evaluator.evaluate(WeightValue.of('0.0000', 'g'), zeroBounds),
    ).toBe('OK');
  });

  it('a ZERO tolerance: `OK` requires the value to equal the target exactly', () => {
    const zeroBand = ZoneBounds.of(
      TARGET,
      Tolerance.of(WeightValue.of('94.0000', 'g'), WeightValue.of('94.0000', 'g')),
    );

    expect(evaluator.evaluate(WeightValue.of('94.0000', 'g'), zeroBand)).toBe(
      'OK',
    );
    expect(evaluator.evaluate(WeightValue.of('94.0001', 'g'), zeroBand)).toBe(
      'OVER',
    );
    expect(evaluator.evaluate(WeightValue.of('93.9999', 'g'), zeroBand)).toBe(
      'NEAR',
    );
  });

  it('NO tolerance at all: the `OK` bounds are the target itself', () => {
    const noBand = ZoneBounds.of(TARGET, null);

    expect(noBand.okLower.text).toBe('94.0000');
    expect(noBand.okUpper.text).toBe('94.0000');
    expect(evaluator.evaluate(WeightValue.of('94.0000', 'g'), noBand)).toBe(
      'OK',
    );
    expect(evaluator.evaluate(WeightValue.of('94.0001', 'g'), noBand)).toBe(
      'OVER',
    );
  });
});

describe('the still to weigh', () => {
  it('is `target − current`', () => {
    expect(stillToWeigh(TARGET, WeightValue.of('40.0000', 'g')).text).toBe(
      '54.0000',
    );
  });

  it('is NEVER negative — the clamp is in the DOMAIN', () => {
    expect(stillToWeigh(TARGET, WeightValue.of('120.0000', 'g')).text).toBe(
      '0.0000',
    );
  });

  it('is zero when the target has been reached exactly', () => {
    expect(stillToWeigh(TARGET, WeightValue.of('94.0000', 'g')).text).toBe(
      '0.0000',
    );
  });

  it('is computed in fixed-point, not in a float', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754.
    const target = WeightValue.of('0.3000', 'g');
    const current = WeightValue.of('0.1000', 'g');
    expect(stillToWeigh(target, current).text).toBe('0.2000');
  });
});

describe('the bounds are computed once', () => {
  it('the near threshold is the SAME number every time', () => {
    const first = ZoneBounds.of(TARGET, BAND);
    const second = ZoneBounds.of(TARGET, BAND);
    expect(first.nearThreshold.text).toBe(second.nearThreshold.text);
  });

  it('a revised target produces NEW bounds, not stale ones', () => {
    const original = ZoneBounds.of(TARGET, BAND);
    const revised = ZoneBounds.of(WeightValue.of('50.0000', 'g'), BAND);

    expect(original.nearThreshold.text).toBe('84.6000');
    expect(revised.nearThreshold.text).toBe('45.0000');
  });
});
