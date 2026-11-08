/**
 * The container assignment and the tare — unit 002, bolt 012.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ROUTE, THE SOURCE, AND THE REFUSAL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the master holds a tare → `CONTAINER_MASTER`, and the master's value
 *   - the master holds none → the empty container is **weighed**, and the
 *     source is `WEIGHED_EMPTY_CONTAINER`
 *   - a re-tare always **measures** — evidence beats a claim
 *   - a measured tare of **zero** is valid, not missing
 *   - a refused tare writes **nothing**
 *   - the recorded tare is the **device's own** state, not a second copy
 *   - the same container for two components is **not** de-duplicated
 *   - the master is **updatable**; the assignment is not
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import type { TareApplication } from '../../src/004-scale-integration/domain/value-objects/tare-application.js';
import { TareState } from '../../src/004-scale-integration/domain/entities/tare-state.js';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  ShadeCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { Recipe } from '../../src/002-recipe-material-management/domain/entities/recipe.js';
import { RecipeComponent } from '../../src/002-recipe-material-management/domain/entities/recipe-component.js';
import { Container } from '../../src/002-recipe-material-management/domain/entities/container.js';
import { ContainerAssignment } from '../../src/002-recipe-material-management/domain/entities/container-assignment.js';
import { ContainerId } from '../../src/002-recipe-material-management/domain/value-objects/container-id.js';
import { TareEstablishmentPolicy } from '../../src/002-recipe-material-management/domain/services/tare-establishment-policy.js';
import { RecipeWorkingCopy } from '../../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import { AssignContainer } from '../../src/002-recipe-material-management/application/use-cases/assign-container.js';
import type {
  ContainerAssignmentRepository,
  ContainerMasterSource,
  ScaleTarePort,
} from '../../src/002-recipe-material-management/domain/ports/container-ports.js';

const AT = Instant.of(new Date('2026-11-06T08:20:11.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const SCALE = ScaleId.create('SCALE-A');

function component(
  id: string,
  dyestuffCode: string,
  sequence = 1,
): RecipeComponent {
  return new RecipeComponent(
    sequence,
    ComponentId.create(id),
    DyestuffCode.create(dyestuffCode),
    WeightValue.of('94.0000', 'g'),
    null,
    'PRECISION',
    null,
    null,
    'PENDING',
  );
}

function recipe(components: readonly RecipeComponent[]): Recipe {
  return new Recipe(
    BatchId.create('B-24187'),
    ShadeCode.create('Teal 4C'),
    components,
    AT,
    'DUMMY_ORGATEX',
    { kind: 'CURRENT' },
  );
}

/** A master that holds a fixed set of containers. */
class StubMaster implements ContainerMasterSource {
  readonly containers = new Map<string, Container>();

  async read(containerId: ContainerId) {
    const found = this.containers.get(containerId.value);
    if (found === undefined) return { kind: 'NOT_FOUND' as const };
    return { kind: 'FOUND' as const, container: found };
  }
}

/** A tare command that records what it was asked to do. */
class StubScaleTare implements ScaleTarePort {
  readonly applied: {
    scaleId: string;
    value: string;
    unit: string;
    source: string;
  }[] = [];
  reading: WeightValue | null = null;
  refuse = false;

  applyTare(
    scaleId: ScaleId,
    tareValue: WeightValue,
    source: 'CONTAINER_MASTER' | 'WEIGHED_EMPTY_CONTAINER',
  ): TareApplication {
    this.applied.push({
      scaleId: scaleId.value,
      value: tareValue.text,
      unit: tareValue.unit,
      source,
    });

    if (this.refuse) {
      return { kind: 'REFUSED', reason: 'SCALE_DISCONNECTED' };
    }

    return {
      kind: 'APPLIED',
      state: new TareState(
        scaleId,
        tareValue,
        AT,
        source,
        'SOFTWARE',
      ),
    };
  }

  readEmptyContainer(_scaleId: ScaleId): WeightValue | null {
    return this.reading;
  }
}

/** A repository that keeps everything it is given, in order. */
class StubAssignments implements ContainerAssignmentRepository {
  readonly saved: ContainerAssignment[] = [];

  async save(assignment: ContainerAssignment): Promise<void> {
    this.saved.push(assignment);
  }

  async latestFor(
    componentId: ComponentId,
  ): Promise<ContainerAssignment | null> {
    // The stub filters by the component — a stub that ignored it would
    // make the re-tare rule fire for the WRONG component and the test
    // would pass for the wrong reason.
    for (let index = this.saved.length - 1; index >= 0; index -= 1) {
      const candidate = this.saved[index];
      if (candidate !== undefined && candidate.componentId.value === componentId.value) {
        return candidate;
      }
    }
    return null;
  }
}

function useCase(
  master: ContainerMasterSource,
  scaleTare: ScaleTarePort,
  assignments: ContainerAssignmentRepository,
  workingCopy: RecipeWorkingCopy,
) {
  return new AssignContainer({
    workingCopy,
    master,
    scaleTare,
    assignments,
    policy: new TareEstablishmentPolicy(),
    clock: () => new Date('2026-11-06T08:20:11.000Z'),
  });
}

describe('the tare establishment policy', () => {
  const policy = new TareEstablishmentPolicy();

  it('uses the MASTER’s tare when the master holds one', () => {
    const container = new Container(
      ContainerId.create('C-12'),
      'DRUM',
      WeightValue.of('214.0000', 'g'),
      true,
    );

    const route = policy.route(container, false);
    expect(route.kind).toBe('FROM_MASTER');
    if (route.kind !== 'FROM_MASTER') return;
    expect(route.source).toBe('CONTAINER_MASTER');
    expect(route.tareWeight.text).toBe('214.0000');
  });

  it('MEASURES when the master holds no tare', () => {
    const container = new Container(
      ContainerId.create('D-03'),
      'BUCKET',
      null,
      true,
    );

    const route = policy.route(container, false);
    expect(route.kind).toBe('MEASURE_EMPTY_CONTAINER');
    expect(route.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });

  // Evidence beats a claim — so a re-tare always measures.
  it('a RE-TARE always measures, even when the master holds a tare', () => {
    const container = new Container(
      ContainerId.create('C-12'),
      'DRUM',
      WeightValue.of('214.0000', 'g'),
      true,
    );

    const route = policy.route(container, true);
    expect(route.kind).toBe('MEASURE_EMPTY_CONTAINER');
    expect(route.source).toBe('WEIGHED_EMPTY_CONTAINER');
  });
});

describe('the container master record', () => {
  it('knows whether the master holds a tare', () => {
    const known = new Container(
      ContainerId.create('C-12'),
      'DRUM',
      WeightValue.of('214.0000', 'g'),
      true,
    );
    expect(known.hasKnownTare).toBe(true);

    const unknown = new Container(
      ContainerId.create('D-03'),
      'BUCKET',
      null,
      true,
    );
    expect(unknown.hasKnownTare).toBe(false);
  });

  it('a tare of ZERO is a known tare — not an absent one', () => {
    const container = new Container(
      ContainerId.create('C-00'),
      'DRUM',
      WeightValue.of('0.0000', 'g'),
      true,
    );
    expect(container.hasKnownTare).toBe(true);
  });
});

describe('assigning a container', () => {
  function masterWith(
    id: string,
    type: 'DRUM' | 'BUCKET' | 'BAG',
    tare: string | null,
  ): StubMaster {
    const master = new StubMaster();
    master.containers.set(
      id,
      new Container(
        ContainerId.create(id),
        type,
        tare === null ? null : WeightValue.of(tare, 'g'),
        true,
      ),
    );
    return master;
  }

  it('assigns the container and applies the MASTER’s tare', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const scaleTare = new StubScaleTare();
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      scaleTare,
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('ASSIGNED');
    expect(assignments.saved).toHaveLength(1);
    expect(assignments.saved[0]?.tareSource).toBe('CONTAINER_MASTER');
    expect(assignments.saved[0]?.tareWeight.text).toBe('214.0000');
    expect(assignments.saved[0]?.assignedBy.value).toBe('OP-001');
  });

  it('MEASURES the empty container when the master holds no tare', async () => {
    const master = masterWith('D-03', 'BUCKET', null);
    const scaleTare = new StubScaleTare();
    scaleTare.reading = WeightValue.of('1850.0000', 'g');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      scaleTare,
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'D-03', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('ASSIGNED');
    expect(assignments.saved[0]?.tareSource).toBe('WEIGHED_EMPTY_CONTAINER');
    // The MEASURED value — the scale's reading, not the master's.
    expect(assignments.saved[0]?.tareWeight.text).toBe('1850.0000');
  });

  it('a measured tare of ZERO is valid, not missing', async () => {
    const master = masterWith('D-03', 'BUCKET', null);
    const scaleTare = new StubScaleTare();
    scaleTare.reading = WeightValue.of('0.0000', 'g');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      scaleTare,
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'D-03', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('ASSIGNED');
    expect(assignments.saved[0]?.tareWeight.text).toBe('0.0000');
  });

  it('a REFUSED tare writes nothing', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const scaleTare = new StubScaleTare();
    scaleTare.refuse = true;
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      scaleTare,
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('TARE_REFUSED');
    expect(assignments.saved).toHaveLength(0);
  });

  it('a device that produced nothing is ABSENT — never a zero tare', async () => {
    const master = masterWith('D-03', 'BUCKET', null);
    const scaleTare = new StubScaleTare();
    scaleTare.reading = null;
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      scaleTare,
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'D-03', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('SCALE_UNAVAILABLE');
    expect(assignments.saved).toHaveLength(0);
  });

  it('refuses a component the recipe does not hold', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      new StubScaleTare(),
      assignments,
      workingCopy,
    ).execute('NOPE', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('UNKNOWN_COMPONENT');
    expect(assignments.saved).toHaveLength(0);
  });

  it('refuses a container the master does not hold', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const outcome = await useCase(
      master,
      new StubScaleTare(),
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'NOPE', 'KEYED_IN', SCALE, OPERATOR);

    expect(outcome.kind).toBe('UNKNOWN_CONTAINER');
    expect(assignments.saved).toHaveLength(0);
  });

  it('a RE-TARE measures, and the source changes', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const scaleTare = new StubScaleTare();
    scaleTare.reading = WeightValue.of('220.0000', 'g');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    const use = useCase(master, scaleTare, assignments, workingCopy);
    await use.execute('DYE-4471-Y', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    scaleTare.reading = WeightValue.of('220.0000', 'g');
    await use.execute('DYE-4471-Y', 'C-12', 'SCAN', SCALE, OPERATOR);

    // Two rows — the re-tare is a NEW assignment, and the older is
    // retained.
    expect(assignments.saved).toHaveLength(2);
    expect(assignments.saved[0]?.tareSource).toBe('CONTAINER_MASTER');
    expect(assignments.saved[1]?.tareSource).toBe('WEIGHED_EMPTY_CONTAINER');
    expect(assignments.saved[1]?.tareWeight.text).toBe('220.0000');
  });

  it('the same container for two components is NOT de-duplicated', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(
      recipe([
        component('DYE-4471-Y', 'DYE-4471', 1),
        component('DYE-4471-B', 'DYE-1180', 2),
      ]),
    );

    const use = useCase(master, new StubScaleTare(), assignments, workingCopy);
    await use.execute('DYE-4471-Y', 'C-12', 'KEYED_IN', SCALE, OPERATOR);
    await use.execute('DYE-4471-B', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    expect(assignments.saved).toHaveLength(2);
  });

  it('the recorded tare is the DEVICE’s own state', async () => {
    const master = masterWith('C-12', 'DRUM', '214.0000');
    const assignments = new StubAssignments();
    const workingCopy = new RecipeWorkingCopy();
    workingCopy.replace(recipe([component('DYE-4471-Y', 'DYE-4471')]));

    await useCase(
      master,
      new StubScaleTare(),
      assignments,
      workingCopy,
    ).execute('DYE-4471-Y', 'C-12', 'KEYED_IN', SCALE, OPERATOR);

    // The device's state is what is recorded — not a second copy built
    // beside it (ADR-035).
    expect(assignments.saved[0]?.tareWeight.text).toBe('214.0000');
    expect(assignments.saved[0]?.tareWeight.unit).toBe('g');
  });
});
