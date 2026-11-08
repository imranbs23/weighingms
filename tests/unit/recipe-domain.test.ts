/**
 * The recipe's domain — unit 002, bolt 010.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PROJECTOR IS PURE, SO IT IS TESTED WITHOUT A MES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The projector is a pure function of a snapshot: no clock, no network, no
 * cache, no freshness decision. So it can be exercised exhaustively with a
 * snapshot built by hand — which is the only way to reach the edge cases
 * the Dummy MES will not produce (a five-decimal-place target, a duplicate
 * sequence, a colour that is not a colour).
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the value objects: the swatch is a TOKEN, the name is bounded, the
 *     state is a closed set of three
 *   - the projector: the order, the states, the counter, the optional facts
 *   - the refusals: a duplicate sequence, too many decimal places, a
 *     colour that is not a colour, a name that is not a name
 *   - the working copy: one copy, replaced by a load
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  ShadeCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import {
  RecipeComponent,
  RecipeSnapshot,
} from '../../src/005-orgatex-integration/domain/entities/snapshots.js';
import { CURRENT, stale } from '../../src/005-orgatex-integration/domain/value-objects/snapshot-freshness.js';
import { Recipe } from '../../src/002-recipe-material-management/domain/entities/recipe.js';
import {
  RecipeProjector,
} from '../../src/002-recipe-material-management/domain/services/recipe-projector.js';
import {
  RecipeWorkingCopy,
} from '../../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import { SwatchColour } from '../../src/002-recipe-material-management/domain/value-objects/swatch-colour.js';
import { MaterialName } from '../../src/002-recipe-material-management/domain/value-objects/material-name.js';
import { RecipeCounter } from '../../src/002-recipe-material-management/domain/value-objects/recipe-counter.js';
import {
  isComponentState,
  type ComponentState,
} from '../../src/002-recipe-material-management/domain/value-objects/component-state.js';
import type { DemandedScaleClass } from '../../src/005-orgatex-integration/domain/value-objects/demanded-scale-class.js';

const AT = Instant.of(new Date('2026-11-05T16:00:00.000Z'));

/**
 * A snapshot component, valid unless a test says otherwise.
 *
 * The overrides are applied **field by field** — the constructor is
 * positional, so a spread would put the object where the first argument
 * goes.
 */
function component(overrides: Partial<RecipeComponent> = {}): RecipeComponent {
  const base = {
    sequence: 1,
    componentId: ComponentId.create('DYE-4471-Y'),
    dyestuffCode: DyestuffCode.create('DYE-4471'),
    target: WeightValue.of('94.0000', 'g'),
    tolerance: Tolerance.of(
      WeightValue.of('93.5000', 'g'),
      WeightValue.of('94.5000', 'g'),
    ),
    scaleClass: 'PRECISION' as DemandedScaleClass | null,
    name: 'Remazol Yellow RGB' as string | null,
    swatchColour: '#d9a520' as string | null,
  };

  const merged = { ...base, ...overrides };

  return new RecipeComponent(
    merged.sequence,
    merged.componentId,
    merged.dyestuffCode,
    merged.target,
    merged.tolerance,
    merged.scaleClass,
    merged.name,
    merged.swatchColour,
  );
}

function snapshot(components: readonly RecipeComponent[]): RecipeSnapshot {
  return new RecipeSnapshot(
    BatchId.create('B-24187'),
    ShadeCode.create('Teal 4C'),
    components,
    AT,
    'DUMMY_ORGATEX',
  );
}

describe('the swatch colour', () => {
  it('accepts the short and the long hex token', () => {
    expect(SwatchColour.of('#abc').value).toBe('#abc');
    expect(SwatchColour.of('#1f4fa8').value).toBe('#1f4fa8');
  });

  it('normalises the case — two spellings are one colour', () => {
    expect(SwatchColour.of('#1F4FA8').equals(SwatchColour.of('#1f4fa8'))).toBe(true);
  });

  // The prototype concatenates the colour into a CSS declaration, so an
  // arbitrary string is a style-injection vector. Everything below is
  // refused.
  it.each([
    ['red', 'a named colour'],
    ['#12345', 'five hex digits'],
    ['#1234567', 'seven hex digits'],
    ['#gggggg', 'non-hex letters'],
    ['red; background-image: url(evil)', 'a second declaration'],
    ['#1f4fa8;', 'a trailing semicolon'],
    ['var(--x)', 'a CSS variable'],
    ['rgb(1,2,3)', 'a functional notation'],
  ])('refuses %s — %s', (raw) => {
    expect(() => SwatchColour.of(raw)).toThrow();
  });
});

describe('the material name', () => {
  it('trims and keeps the text', () => {
    expect(MaterialName.of('  Soda Ash  ').value).toBe('Soda Ash');
  });

  it('refuses an empty name', () => {
    expect(() => MaterialName.of('   ')).toThrow();
  });

  it('refuses a name longer than the bound', () => {
    expect(() => MaterialName.of('x'.repeat(201))).toThrow();
  });
});

describe('the component state', () => {
  it('is a closed set of three', () => {
    expect(isComponentState('PENDING')).toBe(true);
    expect(isComponentState('ACTIVE')).toBe(true);
    expect(isComponentState('DONE')).toBe(true);
    expect(isComponentState('WEIGHING')).toBe(false);
    expect(isComponentState('done')).toBe(false);
    expect(isComponentState(undefined)).toBe(false);
  });
});

describe('the counter', () => {
  it('counts only the DONE components', () => {
    const counter = RecipeCounter.of([
      { state: 'DONE' },
      { state: 'DONE' },
      { state: 'ACTIVE' },
      { state: 'PENDING' },
    ]);

    expect(counter.weighed).toBe(2);
    expect(counter.total).toBe(4);
    expect(counter.isComplete).toBe(false);
  });

  it('is complete when every component is DONE', () => {
    const counter = RecipeCounter.of([{ state: 'DONE' }, { state: 'DONE' }]);
    expect(counter.isComplete).toBe(true);
  });

  it('is NOT complete when the recipe is empty', () => {
    expect(RecipeCounter.of([]).isComplete).toBe(false);
  });
});

describe('the projector', () => {
  const projector = new RecipeProjector();

  it('projects a snapshot into the station recipe', () => {
    const recipe = projector.project(snapshot([component()]), CURRENT);

    expect(recipe.batchId.value).toBe('B-24187');
    expect(recipe.shadeCode.value).toBe('Teal 4C');
    expect(recipe.count).toBe(1);
    expect(recipe.source).toBe('DUMMY_ORGATEX');
  });

  it('carries the freshness through UNCHANGED', () => {
    const fresh = projector.project(snapshot([component()]), CURRENT);
    expect(fresh.freshness.kind).toBe('CURRENT');

    const aged = projector.project(snapshot([component()]), stale(5000));
    expect(aged.freshness.kind).toBe('STALE');
  });

  it('sets every component PENDING — the progression is unit 003’s', () => {
    const recipe = projector.project(snapshot([component()]), CURRENT);
    expect(recipe.components[0]?.state).toBe('PENDING');
  });

  it('orders the components by their sequence', () => {
    const recipe = projector.project(
      snapshot([
        component({ sequence: 3, componentId: ComponentId.create('C-3') }),
        component({ sequence: 1, componentId: ComponentId.create('C-1') }),
        component({ sequence: 2, componentId: ComponentId.create('C-2') }),
      ]),
      CURRENT,
    );

    expect(recipe.components.map((c) => c.componentId.value)).toEqual([
      'C-1',
      'C-2',
      'C-3',
    ]);
  });

  it('derives the counter from the states', () => {
    const recipe = projector.project(snapshot([component()]), CURRENT);
    expect(recipe.counter.weighed).toBe(0);
    expect(recipe.counter.total).toBe(1);
  });

  it('carries the display facts when the MES supplied them', () => {
    const recipe = projector.project(snapshot([component()]), CURRENT);
    expect(recipe.components[0]?.name?.value).toBe('Remazol Yellow RGB');
    expect(recipe.components[0]?.swatchColour?.value).toBe('#d9a520');
  });

  it('carries absent display facts as null', () => {
    const recipe = projector.project(
      snapshot([component({ name: null, swatchColour: null })]),
      CURRENT,
    );
    expect(recipe.components[0]?.name).toBeNull();
    expect(recipe.components[0]?.swatchColour).toBeNull();
  });

  it('refuses a DUPLICATE sequence — the order must be unambiguous', () => {
    expect(() =>
      projector.project(
        snapshot([
          component({ sequence: 1, componentId: ComponentId.create('C-1') }),
          component({ sequence: 1, componentId: ComponentId.create('C-2') }),
        ]),
        CURRENT,
      ),
    ).toThrow(/sequence/);
  });

  it('refuses a target with MORE than four decimal places', () => {
    expect(() =>
      projector.project(
        snapshot([
          component({ target: WeightValue.of('94.00001', 'g') }),
        ]),
        CURRENT,
      ),
    ).toThrow(/decimal places/);
  });

  it('accepts exactly four decimal places', () => {
    const recipe = projector.project(
      snapshot([component({ target: WeightValue.of('94.0000', 'g') })]),
      CURRENT,
    );
    expect(recipe.components[0]?.target.text).toBe('94.0000');
  });

  it('refuses a tolerance bound with too many decimal places', () => {
    expect(() =>
      projector.project(
        snapshot([
          component({
            tolerance: Tolerance.of(
              WeightValue.of('93.50000', 'g'),
              WeightValue.of('94.5000', 'g'),
            ),
          }),
        ]),
        CURRENT,
      ),
    ).toThrow(/decimal places/);
  });

  it('refuses a swatch that is not a colour token', () => {
    expect(() =>
      projector.project(
        snapshot([component({ swatchColour: null })]),
        CURRENT,
      ),
    ).not.toThrow();

    // The seam would have refused an unusable colour before it got here —
    // but the projector refuses one too, so a future adapter cannot smuggle
    // a bad value past it.
    const bad = new RecipeComponent(
      1,
      ComponentId.create('C-1'),
      DyestuffCode.create('D-1'),
      WeightValue.of('94.0000', 'g'),
      null,
      'PRECISION',
      null,
      'red; background-image: url(evil)',
    );
    expect(() => projector.project(snapshot([bad]), CURRENT)).toThrow();
  });

  it('finds a component by its id', () => {
    const recipe = projector.project(snapshot([component()]), CURRENT);
    expect(recipe.componentById('DYE-4471-Y')).not.toBeNull();
    expect(recipe.componentById('NOPE')).toBeNull();
  });
});

describe('the working copy', () => {
  it('starts empty', () => {
    const copy = new RecipeWorkingCopy();
    expect(copy.current()).toBeNull();
    expect(copy.isLoaded).toBe(false);
  });

  it('holds ONE recipe, and a load replaces it', () => {
    const copy = new RecipeWorkingCopy();
    const projector = new RecipeProjector();

    const first = projector.project(snapshot([component()]), CURRENT);
    copy.replace(first);
    expect(copy.current()).toBe(first);

    const second = projector.project(
      snapshot([component({ componentId: ComponentId.create('C-2') })]),
      CURRENT,
    );
    copy.replace(second);
    expect(copy.current()).toBe(second);
    expect(copy.current()?.count).toBe(1);
  });

  it('can be cleared', () => {
    const copy = new RecipeWorkingCopy();
    const projector = new RecipeProjector();
    copy.replace(projector.project(snapshot([component()]), CURRENT));
    copy.clear();
    expect(copy.current()).toBeNull();
  });
});

describe('the recipe aggregate', () => {
  it('refuses two components with the same sequence', () => {
    const projector = new RecipeProjector();
    const recipe = projector.project(snapshot([component()]), CURRENT);

    const first = recipe.components[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    expect(
      () =>
        new Recipe(
          recipe.batchId,
          recipe.shadeCode,
          [first, first],
          recipe.receivedAt,
          recipe.source,
          recipe.freshness,
        ),
    ).toThrow(/sequence/);
  });

  it('knows whether a component may proceed', () => {
    const projector = new RecipeProjector();

    const ready = projector.project(snapshot([component()]), CURRENT);
    expect(ready.components[0]?.canProceed).toBe(true);

    const noClass = projector.project(
      snapshot([component({ scaleClass: null })]),
      CURRENT,
    );
    expect(noClass.components[0]?.canProceed).toBe(false);

    const noTolerance = projector.project(
      snapshot([component({ tolerance: null })]),
      CURRENT,
    );
    expect(noTolerance.components[0]?.canProceed).toBe(false);
  });
});
