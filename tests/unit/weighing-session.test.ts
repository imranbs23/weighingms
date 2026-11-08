/**
 * The weighing session — unit 003, bolt 013.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATE MACHINE AND THE READING RULES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - exactly ONE component is active at a time
 *   - `DONE` is terminal — a completed component cannot be re-selected
 *   - selecting a component resets the weight to zero
 *   - each of the FIVE reading rules, separately
 *   - a discarded reading retains the previous weight
 *   - `stable = false` is surfaced, not collapsed
 *   - a disconnected scale blocks weighing and retains the weight, stale
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
import {
  BatchId,
  ComponentId,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingSession } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../src/003-weighing-station/domain/entities/weighing-session.js';

const AT = Instant.of(new Date('2026-11-06T09:00:00.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const SCALE = ScaleId.create('SCALE-A');
const OTHER_SCALE = ScaleId.create('SCALE-B');

function session(
  components: readonly string[] = ['DYE-4471-Y'],
): WeighingSession {
  return new WeighingSession({
    sessionId: 'WS-1',
    batchId: BatchId.create('B-24187'),
    operatorId: OPERATOR,
    startedAt: AT,
    components: components.map(
      (id): ComponentProgress => ({
        componentId: ComponentId.create(id),
        state: 'PENDING',
      }),
    ),
  });
}

describe('the weighing session', () => {
  it('starts AWAITING_BATCH', () => {
    expect(session().state).toBe('AWAITING_BATCH');
  });

  it('selecting a component moves it to WEIGHING and binds the scale', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);

    expect(s.state).toBe('WEIGHING');
    expect(s.activeComponentId?.value).toBe('DYE-4471-Y');
    expect(s.selectedScaleId?.value).toBe('SCALE-A');
  });

  it('exactly ONE component is active at a time', () => {
    const s = session(['A', 'B']);
    s.selectComponent(ComponentId.create('A'), SCALE);
    s.selectComponent(ComponentId.create('B'), SCALE);

    const active = s.components.filter((entry) => entry.state === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0]?.componentId.value).toBe('B');
  });

  it('DONE is terminal — a completed component cannot be re-selected', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    // The component is finished.
    const entry = s.components[0];
    if (entry === undefined) return;
    entry.state = 'DONE';

    expect(() =>
      s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE),
    ).toThrow(/DONE/);
  });

  it('refuses a component the session does not hold', () => {
    const s = session();
    expect(() =>
      s.selectComponent(ComponentId.create('NOPE'), SCALE),
    ).toThrow();
  });

  it('selecting a component RESETS the weight to zero', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';

    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );
    expect(s.currentWeight?.text).toBe('40.0000');

    // A different component — and the weight is gone.
    const other = session(['A', 'B']);
    other.selectComponent(ComponentId.create('A'), SCALE);
    other.componentUnit = 'g';
    other.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );
    other.selectComponent(ComponentId.create('B'), SCALE);

    expect(other.currentWeight).toBeNull();
    expect(other.lastAcceptedSequence).toBeNull();
  });
});

describe('the reading rules', () => {
  function weighing(): WeighingSession {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';
    return s;
  }

  it('accepts a reading and updates the weight', () => {
    const s = weighing();
    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );

    expect(outcome.kind).toBe('ACCEPTED');
    expect(s.currentWeight?.text).toBe('40.0000');
  });

  it('discards an OUT OF ORDER reading — a lower sequence', () => {
    const s = weighing();
    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(5),
    );

    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('30.0000', 'g'),
      true,
      ReadingSequence.of(3),
    );

    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('OUT_OF_ORDER');
    // The weight is RETAINED — not zeroed.
    expect(s.currentWeight?.text).toBe('40.0000');
  });

  it('discards a reading from the WRONG SCALE', () => {
    const s = weighing();
    const outcome = s.offerReading(
      OTHER_SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );

    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('WRONG_SCALE');
    expect(s.currentWeight).toBeNull();
  });

  it('discards a reading in the WRONG UNIT', () => {
    const s = weighing();
    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('1.5000', 'kg'),
      true,
      ReadingSequence.of(1),
    );

    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('WRONG_UNIT');
    expect(s.currentWeight).toBeNull();
  });

  it('discards a reading while the session is NOT WEIGHING', () => {
    const s = session();
    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );

    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('NOT_WEIGHING');
  });

  it('SURFACES a settling reading — `stable` is not collapsed', () => {
    const s = weighing();
    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      false,
      ReadingSequence.of(1),
    );

    expect(s.weightIsStable).toBe(false);
    expect(s.currentWeight?.text).toBe('40.0000');
  });

  it('a discarded reading does NOT move the sequence floor', () => {
    const s = weighing();
    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(5),
    );
    // A wrong-unit reading at a HIGHER sequence is discarded — and the
    // floor stays at 5, because a discarded reading was never accepted.
    s.offerReading(
      SCALE,
      WeightValue.of('1.0000', 'kg'),
      true,
      ReadingSequence.of(9),
    );

    expect(s.lastAcceptedSequence).toBe(5);

    // And a reading at 6 is accepted.
    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('50.0000', 'g'),
      true,
      ReadingSequence.of(6),
    );
    expect(outcome.kind).toBe('ACCEPTED');
  });
});

describe('the disconnection', () => {
  it('blocks weighing and RETAINS the weight, marked stale', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';
    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );

    s.scaleLost();

    // Weighing is blocked, and the last known weight is retained.
    expect(s.state).not.toBe('WEIGHING');
    expect(s.selectedScaleId).toBeNull();
    expect(s.currentWeight?.text).toBe('40.0000');
    expect(s.weightIsStale).toBe(true);
  });

  it('the scale coming back re-establishes the session — no operator action', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';
    s.scaleLost();

    s.scaleRestored(SCALE);

    expect(s.state).toBe('WEIGHING');
    expect(s.selectedScaleId?.value).toBe('SCALE-A');
  });

  it('a reading while the scale is gone is discarded', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';
    s.scaleLost();

    const outcome = s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );

    expect(outcome.kind).toBe('DISCARDED');
  });
});

describe('the session’s restoration', () => {
  it('restores the live state — including the sequence floor', () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    s.componentUnit = 'g';
    s.offerReading(
      SCALE,
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(7),
    );

    // A restart: the session comes back from its persisted state.
    const restored = session();
    restored.restore({
      state: 'WEIGHING',
      activeComponentId: ComponentId.create('DYE-4471-Y'),
      selectedScaleId: SCALE,
      currentWeight: WeightValue.of('40.0000', 'g'),
      stable: true,
      stale: false,
      sequence: 7,
    });

    expect(restored.state).toBe('WEIGHING');
    expect(restored.currentWeight?.text).toBe('40.0000');
    expect(restored.lastAcceptedSequence).toBe(7);

    // And a REPLAYED reading is still rejected — the floor survived.
    restored.componentUnit = 'g';
    const outcome = restored.offerReading(
      SCALE,
      WeightValue.of('30.0000', 'g'),
      true,
      ReadingSequence.of(5),
    );
    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('OUT_OF_ORDER');
  });
});
