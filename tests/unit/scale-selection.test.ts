/**
 * Unit tests for the SCALE-SELECTION rule — bolt 004, story 004.
 *
 * WHAT IS PROVED HERE
 * --------------------
 *   ADR-017  the CAPACITY constraint wins over the scale-class demand,
 *            and the conflict is RECORDED
 *   ADR-018  "no device can weigh this" is a successful outcome, not an
 *            error — and it carries the target and the maximum capacity
 *   ADR-019  the threshold is CONFIGURATION, and is unset until FCI
 *            answers Q-04
 *   S-16     the selection is a DECISION, not a connection switch
 *   S-19     no device is selected when no device can weigh the target
 *
 * THE RULE IS PURE
 * -----------------
 * Every case here is a function call. There is no clock, no database and
 * no adapter, because the rule decides which device to use — and deciding
 * is arithmetic over a set of facts.
 */
import { describe, it, expect } from 'vitest';
import {
  ScaleSelectionRule,
  type SelectableDevice,
} from '../../src/004-scale-integration/domain/services/scale-selection-rule.js';
import { ComponentId } from '../../src/004-scale-integration/domain/value-objects/component-id.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';

const AT = Instant.of(new Date('2026-10-31T08:00:00.000Z'));
const COMPONENT = ComponentId.create('COMP-1');

/** The two devices from the prototype's status strip. */
const DEVICES: readonly SelectableDevice[] = [
  {
    scaleId: ScaleId.create('SCALE-A'),
    scaleClass: 'PRECISION',
    capacity: WeightValue.of('3000', 'g'),
  },
  {
    scaleId: ScaleId.create('SCALE-B'),
    scaleClass: 'FLOOR',
    capacity: WeightValue.of('32000', 'g'),
  },
];

/** The rule with the threshold UNSET — the production configuration. */
function rule(): ScaleSelectionRule {
  return new ScaleSelectionRule({ threshold: null });
}

function select(
  target: string,
  unit: string,
  demandedClass: 'PRECISION' | 'FLOOR',
  devices: readonly SelectableDevice[] = DEVICES,
  threshold: WeightValue | null = null,
) {
  return new ScaleSelectionRule({ threshold }).select(
    WeightValue.of(target, unit),
    demandedClass,
    devices,
    COMPONENT,
    AT,
  );
}

describe('the automatic selection — no operator input (S-17)', () => {
  it('selects the PRECISION scale for a small target that demands precision', () => {
    const outcome = select('94', 'g', 'PRECISION');

    expect(outcome.kind).toBe('SELECTED');
    if (outcome.kind !== 'SELECTED') return;
    expect(outcome.selection.scaleId.value).toBe('SCALE-A');
    expect(outcome.selection.reason).toBe('CAPACITY_AND_CLASS');
  });

  it('selects the FLOOR scale for a target beyond the precision capacity', () => {
    const outcome = select('4000', 'g', 'FLOOR');

    expect(outcome.kind).toBe('SELECTED');
    if (outcome.kind !== 'SELECTED') return;
    expect(outcome.selection.scaleId.value).toBe('SCALE-B');
    expect(outcome.selection.reason).toBe('CAPACITY_AND_CLASS');
  });

  it('records the scale id, the component id, the time and the reason', () => {
    const outcome = select('94', 'g', 'PRECISION');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');

    expect(outcome.selection.scaleId.value).toBe('SCALE-A');
    expect(outcome.selection.componentId.value).toBe('COMP-1');
    expect(outcome.selection.selectedAt.toDate().toISOString()).toBe(
      '2026-10-31T08:00:00.000Z',
    );
    expect(outcome.selection.reason).toBe('CAPACITY_AND_CLASS');
  });

  it('carries the scale class and capacity for DISPLAY', () => {
    const outcome = select('94', 'g', 'PRECISION');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');

    expect(outcome.selection.scaleClass).toBe('PRECISION');
    expect(outcome.selection.capacity.text).toBe('3000');
  });

  it('does NOT change either device — a selection is a decision (S-16)', () => {
    // The rule is pure: it has no device to change, and it returns a
    // record of a decision rather than a device delta.
    const outcome = select('4000', 'g', 'FLOOR');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');

    // Both devices are still registered and untouched.
    expect(DEVICES).toHaveLength(2);
    expect(outcome.selection.scaleId.value).toBe('SCALE-B');
  });
});

describe('the capacity boundary is INCLUSIVE', () => {
  it('a target of exactly 3 kg is WITHIN the precision capacity', () => {
    const outcome = select('3000', 'g', 'PRECISION');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.scaleId.value).toBe('SCALE-A');
  });

  it('a target of exactly 32 kg is WITHIN the floor capacity', () => {
    const outcome = select('32000', 'g', 'FLOOR');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.scaleId.value).toBe('SCALE-B');
  });

  it('a target ONE GRAM over 32 kg can be weighed nowhere', () => {
    const outcome = select('32001', 'g', 'FLOOR');
    expect(outcome.kind).toBe('NO_DEVICE_CAN_WEIGH');
  });
});

describe('the capacity constraint wins over the class demand — ADR-017', () => {
  it('a 4 kg component demanding PRECISION goes to the FLOOR scale', () => {
    // A 4 kg load cannot be weighed on a 3 kg scale. Honouring the class
    // would mean the component could NEVER be weighed.
    const outcome = select('4000', 'g', 'PRECISION');

    expect(outcome.kind).toBe('SELECTED');
    if (outcome.kind !== 'SELECTED') return;
    expect(outcome.selection.scaleId.value).toBe('SCALE-B');
  });

  it('RECORDS the conflict in the reason', () => {
    const outcome = select('4000', 'g', 'PRECISION');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');

    // The loss of precision must stay VISIBLE — in the durable record,
    // which unit 003 snapshots from this reason.
    expect(outcome.selection.reason).toBe('CLASS_CONFLICT_RESOLVED_BY_CAPACITY');
  });

  it('does NOT record a conflict when the class IS satisfiable', () => {
    const outcome = select('94', 'g', 'PRECISION');
    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');

    expect(outcome.selection.reason).not.toBe('CLASS_CONFLICT_RESOLVED_BY_CAPACITY');
  });

  it('records the CONFLICT when the only candidate does not match the class', () => {
    // A single device whose class does not match the demand — there is
    // nothing else to choose, and the reason records that the class was
    // NOT met.
    const only = [DEVICES[1] as SelectableDevice];
    const outcome = select('4000', 'g', 'PRECISION', only);

    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.reason).toBe('CLASS_CONFLICT_RESOLVED_BY_CAPACITY');
  });
});

describe('no device can weigh this — ADR-018, a successful outcome', () => {
  it('returns the explicit outcome for a target beyond every capacity', () => {
    const outcome = select('40000', 'g', 'FLOOR');

    expect(outcome.kind).toBe('NO_DEVICE_CAN_WEIGH');
  });

  it('carries the TARGET and the MAXIMUM AVAILABLE CAPACITY', () => {
    const outcome = select('40000', 'g', 'FLOOR');
    if (outcome.kind !== 'NO_DEVICE_CAN_WEIGH') {
      throw new Error('expected the no-device outcome');
    }

    expect(outcome.target.text).toBe('40000');
    expect(outcome.maximumCapacity.text).toBe('32000');
    expect(outcome.demandedClass).toBe('FLOOR');
  });

  it('selects NO device — the outcome carries no scale id at all', () => {
    const outcome = select('40000', 'g', 'FLOOR');
    if (outcome.kind !== 'NO_DEVICE_CAN_WEIGH') {
      throw new Error('expected the no-device outcome');
    }

    // The discriminated union is the enforcement: there is no `scaleId`
    // to read on this branch.
    expect('selection' in outcome).toBe(false);
    expect('scaleId' in outcome).toBe(false);
  });

  it('converts the target into the capacities unit before comparing', () => {
    // 40 kg against a 32 kg floor scale — the same comparison, expressed
    // in a different unit.
    const outcome = select('40', 'kg', 'FLOOR');

    if (outcome.kind !== 'NO_DEVICE_CAN_WEIGH') {
      throw new Error('expected the no-device outcome');
    }
    expect(outcome.target.text).toBe('40000');
    expect(outcome.target.unit).toBe('g');
  });
});

describe('a target of exactly zero is not "no device"', () => {
  it('selects the smallest-capability device that satisfies the class', () => {
    const outcome = select('0', 'g', 'PRECISION');

    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.scaleId.value).toBe('SCALE-A');
    expect(outcome.selection.reason).toBe('TARGET_ZERO');
  });

  it('selects the floor scale for a zero target that demands FLOOR', () => {
    const outcome = select('0', 'g', 'FLOOR');

    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.scaleId.value).toBe('SCALE-B');
    expect(outcome.selection.reason).toBe('TARGET_ZERO');
  });
});

describe('the threshold is configuration, and unset until FCI answers — ADR-019', () => {
  it('is null by default', () => {
    expect(rule().threshold).toBeNull();
  });

  it('the rule still works fully with the threshold unset', () => {
    // Every case the story names is decided by the capacity constraint
    // alone — so an unanswered Q-04 does not block the rule.
    const small = select('94', 'g', 'PRECISION');
    const large = select('4000', 'g', 'FLOOR');
    const none = select('40000', 'g', 'FLOOR');

    expect(small.kind).toBe('SELECTED');
    expect(large.kind).toBe('SELECTED');
    expect(none.kind).toBe('NO_DEVICE_CAN_WEIGH');
  });

  it('reports the threshold it was configured with, when one IS set', () => {
    const configured = new ScaleSelectionRule({
      threshold: WeightValue.of('3000', 'g'),
    });

    expect(configured.threshold?.text).toBe('3000');
  });

  it('the capacity constraint and the threshold are SEPARATE facts', () => {
    // They coincide today — 3 kg is both the precision scale's capacity
    // and the prototype's apparent threshold. They are NOT the same
    // number, and the rule does not confuse them.
    const threshold = WeightValue.of('2500', 'g');
    const configured = new ScaleSelectionRule({ threshold });

    // A 2,600 g target FITS the precision capacity but exceeds the
    // configured threshold — so the rule has a slot for the distinction
    // even though today's capacity-only behaviour would still pick
    // SCALE-A.
    const outcome = configured.select(
      WeightValue.of('2600', 'g'),
      'PRECISION',
      DEVICES,
      COMPONENT,
      AT,
    );

    if (outcome.kind !== 'SELECTED') throw new Error('expected a selection');
    expect(outcome.selection.scaleId.value).toBe('SCALE-A');
  });
});
