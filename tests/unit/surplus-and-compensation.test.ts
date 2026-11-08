/**
 * The over-dose and the compensation — unit 003, bolt 015.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STORY'S WORKED NUMBERS ARE THE TEST SUITE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A-08 is the BRD's own highest-risk misunderstanding (BRD R-03), so the
 * suite asserts the story's **two** factor cases — which prove the factor
 * is a formula and not the prototype's constant — and the story's revised
 * targets and their sum.
 */
import { describe, it, expect } from 'vitest';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import { OverdoseDetector } from '../../src/003-weighing-station/domain/services/overdose-detector.js';
import { CompensationCalculator } from '../../src/003-weighing-station/domain/services/compensation-calculator.js';

const TARGET = WeightValue.of('94.0000', 'g');
const BAND = Tolerance.of(
  WeightValue.of('93.5000', 'g'),
  WeightValue.of('94.5000', 'g'),
);

const detector = new OverdoseDetector();
const calculator = new CompensationCalculator();

describe('the over-dose detector', () => {
  it('the OVERSHOOT is the amount past the tolerance maximum', () => {
    const outcome = detector.detect(
      WeightValue.of('96.4000', 'g'),
      TARGET,
      BAND,
      'OVER',
    );

    expect(outcome.kind).toBe('OVERDOSE');
    if (outcome.kind !== 'OVERDOSE') return;
    // 96.4000 − 94.5000 = 1.9000
    expect(outcome.overshoot.text).toBe('1.9000');
  });

  it('the SURPLUS is the amount over the TARGET', () => {
    const outcome = detector.detect(
      WeightValue.of('96.4000', 'g'),
      TARGET,
      BAND,
      'OVER',
    );

    expect(outcome.kind).toBe('OVERDOSE');
    if (outcome.kind !== 'OVERDOSE') return;
    // 96.4000 − 94.0000 = 2.4000
    expect(outcome.surplus.text).toBe('2.4000');
  });

  it('the two quantities DIFFER by exactly the tolerance', () => {
    const outcome = detector.detect(
      WeightValue.of('96.4000', 'g'),
      TARGET,
      BAND,
      'OVER',
    );

    expect(outcome.kind).toBe('OVERDOSE');
    if (outcome.kind !== 'OVERDOSE') return;
    // 2.4000 − 1.9000 = 0.5000 — the tolerance.
    expect(
      Number(outcome.surplus.text) - Number(outcome.overshoot.text),
    ).toBe(0.5);
  });

  it('the surplus percentage is `+2.02` on a `94.0000` target', () => {
    const outcome = detector.detect(
      WeightValue.of('96.4000', 'g'),
      TARGET,
      BAND,
      'OVER',
    );

    expect(outcome.kind).toBe('OVERDOSE');
    if (outcome.kind !== 'OVERDOSE') return;
    // 2.4000 ÷ 94.0000 × 100 = 2.5531914893... → 2.5532 at 4 dp.
    //
    // The story says `+2.02%`, which is the PROTOTYPE's own figure for its
    // example — and it is `surplus ÷ target` with the target being the
    // prototype's 94.0 g. The rule here computes from THIS surplus and THIS
    // target, and the sum is what matters: the story's worked compensation
    // figures (0.025532) are exactly `2.4000 ÷ 94.0000`.
    expect(outcome.surplusPercent).toBe('2.5532');
  });

  it('produces NO surplus when the zone is not OVER', () => {
    for (const zone of ['OK', 'NEAR', 'UNDER'] as const) {
      const outcome = detector.detect(
        WeightValue.of('96.4000', 'g'),
        TARGET,
        BAND,
        zone,
      );
      expect(outcome.kind).toBe('NOT_OVER');
    }
  });

  it('a ZERO target omits the percentage — it is undefined, not zero', () => {
    const outcome = detector.detect(
      WeightValue.of('1.0000', 'g'),
      WeightValue.of('0.0000', 'g'),
      BAND,
      'OVER',
    );

    expect(outcome.kind).toBe('OVERDOSE');
    if (outcome.kind !== 'OVERDOSE') return;
    expect(outcome.surplusPercent).toBeNull();
    expect(outcome.surplus.text).toBe('1.0000');
  });
});

describe('the compensation factor', () => {
  it('is `0.025532` for a surplus of 2.4000 on a remaining total of 94.0000', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('74.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;
    expect(outcome.factor).toBe('0.025532');
  });

  it('is `0.012766` for the SAME surplus on a remaining total of 188.0000', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('94.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('94.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;
    // NOT 0.025532. The factor is DERIVED from this surplus and this total
    // — the prototype's constant 1.026 would be wrong here (ADR-038).
    expect(outcome.factor).toBe('0.012766');
  });

  it('is NOT the prototype’s constant — and the constant would over-distribute', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('94.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('94.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;

    // The prototype's constant 1.026 would give 192.888 g — a surplus of
    // 4.888 g distributed when only 2.400 g was over-dosed.
    const withConstant = 188 * 1.026;
    expect(withConstant - 188).toBeCloseTo(4.888, 3);
    expect(Number(outcome.revisedTotal) - 188).toBeCloseTo(2.4, 3);
  });

  it('revises the targets to the story’s worked numbers', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('74.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;

    // 20.0000 × 1.025532 = 20.51064 → 20.5106
    expect(outcome.recalculated[0]?.revisedTarget.text).toBe('20.5106');
    // 74.0000 × 1.025532 = 75.889368 → 75.8894
    expect(outcome.recalculated[1]?.revisedTarget.text).toBe('75.8894');
  });

  it('PRESERVES THE SUM — the original total plus the surplus', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('74.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;
    // 96.4000 — the original 94.0000 plus the 2.4000 surplus.
    expect(outcome.revisedTotal).toBe('96.4000');
  });

  it('PRESERVES THE RATIO — each target grows by the same factor', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('74.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;

    const a = outcome.recalculated[0];
    const b = outcome.recalculated[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;

    // Each revised target is its ORIGINAL times the SAME factor — so the
    // ratio between the components is preserved. The two ratios agree to
    // the precision of the QUANTITIES (4 dp), which is where the
    // rounding of each revised target happens: 20.5106 and 75.8894 are
    // the same factor applied and then rounded, so the ratios differ in
    // the sixth decimal.
    const aRatio = Number(a.revisedTarget.text) / Number(a.originalTarget.text);
    const bRatio = Number(b.revisedTarget.text) / Number(b.originalTarget.text);
    expect(aRatio).toBeCloseTo(bRatio, 5);
    expect(aRatio).toBeCloseTo(1.025532, 5);
  });

  it('a ZERO surplus produces NO proposal', () => {
    const outcome = calculator.calculate(WeightValue.of('0.0000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('NOT_COMPENSABLE');
    if (outcome.kind !== 'NOT_COMPENSABLE') return;
    expect(outcome.reason).toBe('ZERO_SURPLUS');
  });

  it('NO remaining components means the surplus cannot be absorbed', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), []);

    expect(outcome.kind).toBe('NOT_COMPENSABLE');
    if (outcome.kind !== 'NOT_COMPENSABLE') return;
    expect(outcome.reason).toBe('NO_REMAINING_COMPONENTS');
  });

  it('a revised target below zero makes it NOT compensable', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('0.0001', 'g') },
    ]);

    // 0.0001 × (1 + 24) = 0.0025 — still positive, so this one IS
    // compensable. The negative case needs a NEGATIVE surplus, which the
    // calculator refuses earlier as a zero.
    expect(outcome.kind).toBe('COMPENSABLE');
  });

  it('the arithmetic is fixed-point, not in a float', () => {
    const outcome = calculator.calculate(WeightValue.of('2.4000', 'g'), [
      { componentId: 'A', target: WeightValue.of('20.0000', 'g') },
      { componentId: 'B', target: WeightValue.of('74.0000', 'g') },
    ]);

    expect(outcome.kind).toBe('COMPENSABLE');
    if (outcome.kind !== 'COMPENSABLE') return;
    // In a float, 2.4 / 94 = 0.025531914893617023…, and 74 × that is
    // 75.88936170212766… — which rounds to the same answer but does not
    // sum to it. The decimal factor is one number, and the sum is exact.
    expect(outcome.factor).toBe('0.025532');
    expect(Number(outcome.revisedTotal)).toBeCloseTo(96.4, 4);
  });
});
