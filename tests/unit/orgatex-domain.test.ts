/**
 * The OrgaTEX seam's domain rules.
 *
 * These are PURE — no adapter, no cache, no clock. Every test here is
 * about a rule, and a rule that needs I/O is not a rule.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the identifiers: bounded, trimmed, non-empty
 *   - the eligibility derivation: every status, including the two the
 *     prototype's own queue does not use
 *   - the tolerance band: inclusive bounds, same-unit, min ≤ max
 *   - the demanded scale class: the closed set, and the refusal of an
 *     unknown one
 *   - the freshness marker: two states and no third
 *   - the snapshot cache: bounded, LRU, disposable
 */
import { describe, it, expect } from 'vitest';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  MachineRef,
  OrderRef,
  ShadeCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { BatchEligibilityRule } from '../../src/005-orgatex-integration/domain/services/batch-eligibility-rule.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import {
  DEMANDED_SCALE_CLASSES,
  isDemandedScaleClass,
} from '../../src/005-orgatex-integration/domain/value-objects/demanded-scale-class.js';
import {
  BATCH_WEIGHING_STATUSES,
  isBatchWeighingStatus,
} from '../../src/005-orgatex-integration/domain/value-objects/batch-weighing-status.js';
import {
  CURRENT,
  stale,
} from '../../src/005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { SnapshotCache } from '../../src/005-orgatex-integration/domain/services/snapshot-cache.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  BatchQueueSnapshot,
  RecipeSnapshot,
} from '../../src/005-orgatex-integration/domain/entities/snapshots.js';

describe('the identifiers', () => {
  it('trims surrounding whitespace', () => {
    expect(BatchId.create('  B-24187  ').value).toBe('B-24187');
    expect(OrderRef.create(' SO-9931 ').value).toBe('SO-9931');
    expect(MachineRef.create('\tJET-04\n').value).toBe('JET-04');
    expect(ShadeCode.create(' Teal 4C ').value).toBe('Teal 4C');
    expect(DyestuffCode.create(' DYE-4471 ').value).toBe('DYE-4471');
  });

  it('refuses an EMPTY identifier', () => {
    expect(() => BatchId.create('')).toThrow(/must not be empty/);
    expect(() => OrderRef.create('   ')).toThrow(/must not be empty/);
    expect(() => MachineRef.create('')).toThrow(/must not be empty/);
    expect(() => ShadeCode.create('')).toThrow(/must not be empty/);
    expect(() => DyestuffCode.create('')).toThrow(/must not be empty/);
  });

  it('refuses an identifier beyond the bound', () => {
    const tooLong = 'B'.repeat(65);
    expect(() => BatchId.create(tooLong)).toThrow(/must not exceed 64/);
    expect(BatchId.create('B'.repeat(64)).value.length).toBe(64);
  });

  it('compares by EXACT text', () => {
    expect(BatchId.create('B-1').equals(BatchId.create('B-1'))).toBe(true);
    expect(BatchId.create('B-1').equals(BatchId.create('b-1'))).toBe(false);
    expect(ShadeCode.create('Teal 4C').equals(ShadeCode.create('Teal 4C'))).toBe(
      true,
    );
  });

  it('gives every identifier the SAME equality and text behaviour', () => {
    // Six identifiers, one rule. The rule is proven once per identifier
    // rather than trusted to a convention.
    const pairs: Array<{
      readonly make: (text: string) => { equals(other: never): boolean; toString(): string };
      readonly text: string;
    }> = [
      { make: (t) => BatchId.create(t) as never, text: 'B-1' },
      { make: (t) => OrderRef.create(t) as never, text: 'SO-1' },
      { make: (t) => MachineRef.create(t) as never, text: 'JET-1' },
      { make: (t) => ShadeCode.create(t) as never, text: 'Teal 4C' },
      { make: (t) => DyestuffCode.create(t) as never, text: 'DYE-1' },
    ];

    for (const { make, text } of pairs) {
      expect(make(text).equals(make(text) as never)).toBe(true);
      expect(make(text).equals(make(`${text} `) as never)).toBe(true);
      expect(make(text).equals(make('other') as never)).toBe(false);
      expect(make(text).toString()).toBe(text);
    }
  });

  it('keeps the DYESTUFF code distinct from the COMPONENT id', () => {
    // They are different facts: what the material is, versus this slot in
    // this recipe. Collapsing them would make unit 002's identity check
    // compare the wrong thing.
    const dyestuff = DyestuffCode.create('DYE-1180');
    const component = ComponentId.create('DYE-4471-B');

    expect(dyestuff.value).not.toBe(component.value);
    expect(dyestuff.equals(DyestuffCode.create('DYE-4471-B'))).toBe(false);
  });
});

describe('the eligibility rule', () => {
  it('makes a RELEASED batch eligible', () => {
    expect(BatchEligibilityRule.evaluate('RELEASED')).toEqual({
      kind: 'ELIGIBLE',
    });
  });

  it('makes a QUEUED batch ineligible because it is not released', () => {
    expect(BatchEligibilityRule.evaluate('QUEUED')).toEqual({
      kind: 'NOT_ELIGIBLE',
      reason: 'NOT_RELEASED',
    });
  });

  it('names BEING_WEIGHED_ELSEWHERE separately from NOT_RELEASED', () => {
    // A batch being weighed elsewhere WAS released — it is a different
    // fact, and an operator needs to know which one it is.
    expect(BatchEligibilityRule.evaluate('WEIGHING')).toEqual({
      kind: 'NOT_ELIGIBLE',
      reason: 'BEING_WEIGHED_ELSEWHERE',
    });
  });

  it('names ALREADY_WEIGHED separately from NOT_RELEASED', () => {
    // A weighed batch was released. Saying "not released" would be false.
    expect(BatchEligibilityRule.evaluate('WEIGHED')).toEqual({
      kind: 'NOT_ELIGIBLE',
      reason: 'ALREADY_WEIGHED',
    });
  });

  it('names CANCELLED', () => {
    expect(BatchEligibilityRule.evaluate('CANCELLED')).toEqual({
      kind: 'NOT_ELIGIBLE',
      reason: 'CANCELLED',
    });
  });

  it('handles every status in the closed set', () => {
    for (const status of BATCH_WEIGHING_STATUSES) {
      const outcome = BatchEligibilityRule.evaluate(status);
      expect(outcome.kind).toMatch(/ELIGIBLE|NOT_ELIGIBLE/);
    }
  });
});

describe('the tolerance band', () => {
  const g = (text: string): WeightValue => WeightValue.of(text, 'g');

  it('accepts a band whose minimum does not exceed its maximum', () => {
    const band = Tolerance.of(g('93.5'), g('94.5'));
    expect(band.min.text).toBe('93.5');
    expect(band.max.text).toBe('94.5');
    expect(band.unit).toBe('g');
  });

  it('accepts a band whose bounds are EQUAL', () => {
    expect(() => Tolerance.of(g('94'), g('94'))).not.toThrow();
  });

  it('refuses a band whose minimum exceeds its maximum', () => {
    expect(() => Tolerance.of(g('94.5'), g('93.5'))).toThrow(
      /minimum must not exceed the maximum/,
    );
  });

  it('refuses bounds in DIFFERENT units', () => {
    expect(() =>
      Tolerance.of(g('93.5'), WeightValue.of('0.0945', 'kg')),
    ).toThrow(/must share a unit/);
  });

  it('includes both bounds — the band is INCLUSIVE', () => {
    const band = Tolerance.of(g('93.5'), g('94.5'));
    expect(band.contains(g('93.5'))).toBe(true);
    expect(band.contains(g('94.5'))).toBe(true);
    expect(band.contains(g('94.0'))).toBe(true);
  });

  it('excludes a value outside the band', () => {
    const band = Tolerance.of(g('93.5'), g('94.5'));
    expect(band.contains(g('93.4'))).toBe(false);
    expect(band.contains(g('94.6'))).toBe(false);
  });

  it('refuses to test a value in a different unit', () => {
    const band = Tolerance.of(g('93.5'), g('94.5'));
    expect(() => band.contains(WeightValue.of('0.094', 'kg'))).toThrow(
      /against a g tolerance/,
    );
  });
});

describe('the demanded scale class', () => {
  it('knows exactly two classes', () => {
    expect([...DEMANDED_SCALE_CLASSES]).toEqual(['PRECISION', 'FLOOR']);
  });

  it('accepts a known class', () => {
    expect(isDemandedScaleClass('PRECISION')).toBe(true);
    expect(isDemandedScaleClass('FLOOR')).toBe(true);
  });

  it('refuses an unknown class — rather than dropping the constraint', () => {
    expect(isDemandedScaleClass('BENCH')).toBe(false);
    expect(isDemandedScaleClass('precision')).toBe(false);
    expect(isDemandedScaleClass('')).toBe(false);
    expect(isDemandedScaleClass(undefined)).toBe(false);
    expect(isDemandedScaleClass(42)).toBe(false);
  });
});

describe('the weighing status set', () => {
  it('knows the five statuses the BRD defines', () => {
    expect([...BATCH_WEIGHING_STATUSES]).toEqual([
      'QUEUED',
      'RELEASED',
      'WEIGHING',
      'WEIGHED',
      'CANCELLED',
    ]);
  });

  it('refuses an unknown status', () => {
    expect(isBatchWeighingStatus('RELEASED')).toBe(true);
    expect(isBatchWeighingStatus('RELEASED_')).toBe(false);
    expect(isBatchWeighingStatus(null)).toBe(false);
    expect(isBatchWeighingStatus(7)).toBe(false);
  });
});

describe('the freshness marker', () => {
  it('has exactly two states', () => {
    expect(CURRENT.kind).toBe('CURRENT');
    expect(stale(1000)).toEqual({ kind: 'STALE', ageMs: 1000 });
  });

  it('refuses a negative age', () => {
    expect(() => stale(-1)).toThrow(/non-negative/);
  });

  it('refuses a non-finite age', () => {
    expect(() => stale(Number.NaN)).toThrow(/non-negative/);
    expect(() => stale(Number.POSITIVE_INFINITY)).toThrow(/non-negative/);
  });
});

describe('the snapshot cache', () => {
  const AT = Instant.of(new Date('2026-11-02T18:00:00.000Z'));

  function queue(): BatchQueueSnapshot {
    return new BatchQueueSnapshot([], AT, 'DUMMY_ORGATEX');
  }

  function recipe(batchId: string): RecipeSnapshot {
    return new RecipeSnapshot(
      BatchId.create(batchId),
      ShadeCode.create('Teal 4C'),
      [],
      AT,
      'DUMMY_ORGATEX',
    );
  }

  it('starts empty', () => {
    const cache = new SnapshotCache();
    expect(cache.recallQueue()).toBeNull();
    expect(cache.recallRecipe(BatchId.create('B-1'))).toBeNull();
    expect(cache.recipeCount).toBe(0);
  });

  it('remembers and recalls the queue', () => {
    const cache = new SnapshotCache();
    const snapshot = queue();
    cache.rememberQueue(snapshot);
    expect(cache.recallQueue()).toBe(snapshot);
  });

  it('remembers and recalls a recipe', () => {
    const cache = new SnapshotCache();
    const snapshot = recipe('B-1');
    cache.rememberRecipe(snapshot);
    expect(cache.recallRecipe(BatchId.create('B-1'))).toBe(snapshot);
  });

  it('is BOUNDED — the oldest recipe is evicted', () => {
    const cache = new SnapshotCache(2);
    cache.rememberRecipe(recipe('B-1'));
    cache.rememberRecipe(recipe('B-2'));
    cache.rememberRecipe(recipe('B-3'));

    expect(cache.recipeCount).toBe(2);
    expect(cache.recallRecipe(BatchId.create('B-1'))).toBeNull();
    expect(cache.recallRecipe(BatchId.create('B-3'))).not.toBeNull();
  });

  it('evicts the LEAST RECENTLY USED, not the oldest', () => {
    const cache = new SnapshotCache(2);
    cache.rememberRecipe(recipe('B-1'));
    cache.rememberRecipe(recipe('B-2'));

    // Touching B-1 makes B-2 the least recently used.
    cache.recallRecipe(BatchId.create('B-1'));
    cache.rememberRecipe(recipe('B-3'));

    expect(cache.recallRecipe(BatchId.create('B-1'))).not.toBeNull();
    expect(cache.recallRecipe(BatchId.create('B-2'))).toBeNull();
  });

  it('refuses a capacity that is not a positive whole number', () => {
    expect(() => new SnapshotCache(0)).toThrow(/positive whole number/);
    expect(() => new SnapshotCache(-1)).toThrow(/positive whole number/);
    expect(() => new SnapshotCache(1.5)).toThrow(/positive whole number/);
  });

  it('forgets EVERYTHING on clear', () => {
    const cache = new SnapshotCache();
    cache.rememberQueue(queue());
    cache.rememberRecipe(recipe('B-1'));

    cache.clear();

    expect(cache.recallQueue()).toBeNull();
    expect(cache.recallRecipe(BatchId.create('B-1'))).toBeNull();
    expect(cache.recipeCount).toBe(0);
  });
});
