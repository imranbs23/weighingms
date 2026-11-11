/**
 * The confirmation gate — unit 003, bolt 014.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CONFIRMATION IS IMPOSSIBLE UNLESS THE ZONE IS `OK`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - `UNDER`, `NEAR` and `OVER` are all refused
 *   - the reason distinguishes the three, so the UI can show the right
 *     next step
 *   - the gate reads the **CURRENT** zone, not a cached one
 *   - a replayed confirmation is **idempotent** — no second record
 *   - the record **snapshots** the target, the band and the scale's class
 *   - bolt 030 (ADR-047): `OVER` passes ONLY with an authorised override,
 *     and the override never opens `UNDER` or `NEAR`
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
import { Tolerance } from '../../src/005-orgatex-integration/domain/value-objects/tolerance.js';
import {
  BatchId,
  ComponentId,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingSession } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import type { WeighingRecord } from '../../src/003-weighing-station/domain/entities/weighing-record.js';
import type { WeighingRecordRepository } from '../../src/003-weighing-station/domain/ports/weighing-record-repository.js';
import { ToleranceZoneEvaluator } from '../../src/003-weighing-station/domain/services/tolerance-zone-evaluator.js';
import { ZoneBounds } from '../../src/003-weighing-station/domain/value-objects/zone-bounds.js';
import { ConfirmWeighing } from '../../src/003-weighing-station/application/use-cases/confirm-weighing.js';
import type { RecipeWorkingCopy } from '../../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import { Recipe } from '../../src/002-recipe-material-management/domain/entities/recipe.js';
import { RecipeComponent } from '../../src/002-recipe-material-management/domain/entities/recipe-component.js';

const AT = Instant.of(new Date('2026-11-06T09:14:22.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const SCALE = ScaleId.create('SCALE-A');
const TARGET = WeightValue.of('94.0000', 'g');
const BAND = Tolerance.of(
  WeightValue.of('93.5000', 'g'),
  WeightValue.of('94.5000', 'g'),
);

class StubRecords implements WeighingRecordRepository {
  readonly saved: WeighingRecord[] = [];

  async save(record: WeighingRecord): Promise<void> {
    this.saved.push(record);
  }

  async latestFor(
    _sessionId: string,
    componentId: ComponentId,
  ): Promise<WeighingRecord | null> {
    for (let index = this.saved.length - 1; index >= 0; index -= 1) {
      const candidate = this.saved[index];
      if (candidate?.componentId.value === componentId.value) return candidate;
    }
    return null;
  }

  async existsFor(): Promise<boolean> {
    return this.saved.length > 0;
  }

  async allFor(): Promise<readonly WeighingRecord[]> {
    return this.saved;
  }

  async between(): Promise<readonly WeighingRecord[]> {
    return this.saved;
  }
}

function workingCopy(): RecipeWorkingCopy {
  const copy = {
    current: () => recipe,
    replace: () => undefined,
    clear: () => undefined,
    isLoaded: true,
  };
  return copy as unknown as RecipeWorkingCopy;
}

const recipe = new Recipe(
  BatchId.create('B-24187'),
  { value: 'Teal 4C' } as never,
  [
    new RecipeComponent(
      1,
      ComponentId.create('DYE-4471-Y'),
      { value: 'DYE-4471' } as never,
      TARGET,
      BAND,
      'PRECISION',
      null,
      null,
      'PENDING',
    ),
  ],
  AT,
  'DUMMY_ORGATEX',
  { kind: 'CURRENT' },
);

describe('the confirmation gate', () => {
  let session: WeighingSession;
  let records: StubRecords;
  let canWeigh: boolean;

  beforeEach(() => {
    session = new WeighingSession({
      sessionId: 'WS-1',
      batchId: BatchId.create('B-24187'),
      operatorId: OPERATOR,
      startedAt: AT,
      components: [
        {
          componentId: ComponentId.create('DYE-4471-Y'),
          state: 'PENDING',
        } as ComponentProgress,
      ],
    });
    session.selectComponent(ComponentId.create('DYE-4471-Y'), SCALE);
    session.componentUnit = 'g';

    records = new StubRecords();
    canWeigh = true;
  });

  function gate(
    authorisedOverride?: (componentId: ComponentId, weight: WeightValue) => boolean,
  ) {
    return new ConfirmWeighing({
      workingCopy: workingCopy(),
      records,
      evaluator: new ToleranceZoneEvaluator(),
      currentWeight: () => session.currentWeight,
      activeComponentId: () => session.activeComponentId,
      selectedScaleId: () => session.selectedScaleId,
      selectedScaleClass: () => 'PRECISION',
      lotNumber: () => '2026-0387',
      containerId: () => 'C-12',
      sessionId: () => 'WS-1',
      canWeigh: () => canWeigh,
      clock: () => new Date('2026-11-06T09:14:22.000Z'),
      ...(authorisedOverride === undefined ? {} : { authorisedOverride }),
    });
  }

  function read(value: string): void {
    session.offerReading(
      SCALE,
      WeightValue.of(value, 'g'),
      true,
      ReadingSequence.of(1),
    );
  }

  it('refuses an UNDER confirmation and writes NOTHING', async () => {
    read('80.0000');

    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.zone).toBe('UNDER');
    expect(outcome.reason).toBe('ZONE_UNDER');
    expect(records.saved).toHaveLength(0);
  });

  it('refuses a NEAR confirmation and writes NOTHING', async () => {
    read('90.0000');

    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.zone).toBe('NEAR');
    expect(outcome.reason).toBe('ZONE_NEAR');
    expect(records.saved).toHaveLength(0);
  });

  it('refuses an OVER confirmation and writes NOTHING', async () => {
    read('120.0000');

    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.zone).toBe('OVER');
    expect(outcome.reason).toBe('ZONE_OVER');
    expect(records.saved).toHaveLength(0);
  });

  it('confirms an OK reading and REPORTS the zone — it writes nothing', async () => {
    read('94.2400');

    const outcome = await gate().execute(OPERATOR);

    // The gate is a DECISION. The record is written by the TRANSITION
    // (bolt 017), which writes it first and advances the session second
    // (ADR-040).
    expect(outcome.kind).toBe('ALLOWED');
    if (outcome.kind !== 'ALLOWED') return;
    expect(outcome.zoneAtConfirm).toBe('OK');
    expect(outcome.componentId.value).toBe('DYE-4471-Y');

    // And the gate wrote NOTHING.
    expect(records.saved).toHaveLength(0);
  });

  it('reads the CURRENT zone — not the one last displayed', async () => {
    // The operator sees OK.
    read('94.2400');

    // And then a reading arrives before they press confirm.
    session.offerReading(
      SCALE,
      WeightValue.of('120.0000', 'g'),
      true,
      ReadingSequence.of(2),
    );

    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.zone).toBe('OVER');
    expect(records.saved).toHaveLength(0);
  });

  it('refuses while the scale has gone away', async () => {
    read('94.2400');
    canWeigh = false;

    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('SCALE_UNAVAILABLE');
    expect(records.saved).toHaveLength(0);
  });

  it('refuses when there is no reading', async () => {
    const outcome = await gate().execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('NO_READING');
    expect(records.saved).toHaveLength(0);
  });

  it('refuses when there is no active component', async () => {
    const empty = new WeighingSession({
      sessionId: 'WS-1',
      batchId: BatchId.create('B-24187'),
      operatorId: OPERATOR,
      startedAt: AT,
      components: [],
    });

    const outcome = await new ConfirmWeighing({
      workingCopy: workingCopy(),
      records,
      evaluator: new ToleranceZoneEvaluator(),
      currentWeight: () => empty.currentWeight,
      activeComponentId: () => empty.activeComponentId,
      selectedScaleId: () => empty.selectedScaleId,
      selectedScaleClass: () => 'PRECISION',
      lotNumber: () => null,
      containerId: () => null,
      sessionId: () => 'WS-1',
      canWeigh: () => true,
      clock: () => new Date('2026-11-06T09:14:22.000Z'),
    }).execute(OPERATOR);

    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('NO_ACTIVE_COMPONENT');
    expect(records.saved).toHaveLength(0);
  });

  describe('the supervisor override (bolt 030, ADR-047)', () => {
    it('ALLOWS an OVER reading with an authorised override — and the zone stays OVER', async () => {
      read('120.0000');

      const outcome = await gate(() => true).execute(OPERATOR);

      expect(outcome.kind).toBe('ALLOWED');
      if (outcome.kind !== 'ALLOWED') return;
      expect(outcome.zoneAtConfirm).toBe('OVER');
      expect(records.saved).toHaveLength(0);
    });

    it('asks about THIS component at THIS weight', async () => {
      read('120.0000');
      const asked: string[] = [];

      await gate((componentId, weight) => {
        asked.push(`${componentId.value} ${weight.text} ${weight.unit}`);
        return false;
      }).execute(OPERATOR);

      expect(asked).toEqual(['DYE-4471-Y 120.0000 g']);
    });

    it('REFUSES OVER when the override is not authorised', async () => {
      read('120.0000');

      const outcome = await gate(() => false).execute(OPERATOR);

      expect(outcome.kind).toBe('REFUSED');
      if (outcome.kind !== 'REFUSED') return;
      expect(outcome.reason).toBe('ZONE_OVER');
    });

    it('never opens UNDER or NEAR — an override is for an over-dose only', async () => {
      const cases = [
        { value: '80.0000', zone: 'UNDER' },
        { value: '90.0000', zone: 'NEAR' },
      ];
      for (const [index, entry] of cases.entries()) {
        session.offerReading(
          SCALE,
          WeightValue.of(entry.value, 'g'),
          true,
          ReadingSequence.of(index + 10),
        );
        const outcome = await gate(() => true).execute(OPERATOR);
        expect(outcome.kind).toBe('REFUSED');
        if (outcome.kind !== 'REFUSED') return;
        expect(outcome.zone).toBe(entry.zone);
      }
    });
  });

  it('the bounds are the same three numbers the zone was computed against', () => {
    const computed = ZoneBounds.of(TARGET, BAND);
    expect(computed.okUpper.text).toBe('94.5000');
    expect(computed.okLower.text).toBe('93.5000');
    expect(computed.nearThreshold.text).toBe('84.6000');
  });
});
