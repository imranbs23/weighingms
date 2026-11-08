/**
 * The container assignment's persistence — unit 002, bolt 012.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO TABLES, TWO MUTABILITY RULES, AND THE DATABASE ENFORCES BOTH.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The **assignments** are append-only — a record of an act (BRD DR-02).
 * The **master** is updatable — reference data, and a container's known
 * tare genuinely changes.
 *
 * And the distinction is asserted here, because a reviewer should be able
 * to see it in one place: the same database, two tables, and one of them
 * refuses a rewrite while the other accepts it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import {
  ComponentId,
  DyestuffCode,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { Container } from '../../src/002-recipe-material-management/domain/entities/container.js';
import { ContainerAssignment } from '../../src/002-recipe-material-management/domain/entities/container-assignment.js';
import { ContainerId } from '../../src/002-recipe-material-management/domain/value-objects/container-id.js';
import {
  openContainerDatabase,
  type SqliteDatabase,
} from '../../src/002-recipe-material-management/infrastructure/persistence/container-database.js';
import {
  SqliteContainerAssignmentRepository,
} from '../../src/002-recipe-material-management/infrastructure/persistence/sqlite-container-assignment-repository.js';
import {
  SqliteContainerMasterRepository,
} from '../../src/002-recipe-material-management/infrastructure/persistence/sqlite-container-master-repository.js';

const AT = Instant.of(new Date('2026-11-06T08:20:11.000Z'));
const OPERATOR = OperatorId.create('OP-001');
const COMPONENT = ComponentId.create('DYE-4471-Y');

describe('the container persistence', () => {
  let db: SqliteDatabase;
  let assignments: SqliteContainerAssignmentRepository;
  let master: SqliteContainerMasterRepository;

  beforeEach(() => {
    db = openContainerDatabase(':memory:');
    assignments = new SqliteContainerAssignmentRepository(db);
    master = new SqliteContainerMasterRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function assignment(
    containerId: string,
    tare = '214.0000',
    method: 'SCAN' | 'KEYED_IN' = 'KEYED_IN',
    source: 'CONTAINER_MASTER' | 'WEIGHED_EMPTY_CONTAINER' = 'CONTAINER_MASTER',
  ): ContainerAssignment {
    return new ContainerAssignment(
      COMPONENT,
      ContainerId.create(containerId),
      'DRUM',
      WeightValue.of(tare, 'g'),
      source,
      method,
      OPERATOR,
      AT,
      ScaleId.create('SCALE-A'),
    );
  }

  // ── The round trip ──

  it('reads an assignment back with every field', async () => {
    await assignments.save(assignment('C-12'));

    const read = await assignments.latestFor(COMPONENT);
    expect(read?.containerId.value).toBe('C-12');
    expect(read?.containerType).toBe('DRUM');
    expect(read?.tareWeight.text).toBe('214.0000');
    expect(read?.tareWeight.unit).toBe('g');
    expect(read?.tareSource).toBe('CONTAINER_MASTER');
    expect(read?.assignmentMethod).toBe('KEYED_IN');
    expect(read?.assignedBy.value).toBe('OP-001');
    expect(read?.scaleId?.value).toBe('SCALE-A');
  });

  it('is null when nothing has been assigned', async () => {
    expect(await assignments.latestFor(COMPONENT)).toBeNull();
  });

  // ── The append-only property ──

  it('refuses an UPDATE on the assignments', async () => {
    await assignments.save(assignment('C-12'));

    expect(() =>
      db
        .prepare(
          `UPDATE container_assignments SET tare_weight = '0.0000' WHERE container_id = ?`,
        )
        .run('C-12'),
    ).toThrow(/append-only/);
  });

  it('refuses a DELETE on the assignments', async () => {
    await assignments.save(assignment('C-12'));

    expect(() =>
      db.prepare(`DELETE FROM container_assignments`).run(),
    ).toThrow(/append-only/);
  });

  // ── The closed sets, in the storage layer ──

  it('refuses a THIRD assignment method', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO container_assignments
             (component_id, container_id, container_type, tare_weight,
              tare_unit, tare_source, assignment_method, operator_id,
              assigned_at, scale_id, recorded_at)
           VALUES (?, 'C-12', 'DRUM', '214.0000', 'g',
                   'CONTAINER_MASTER', 'GUESSED', ?, ?, NULL, ?)`,
        )
        .run(COMPONENT.value, OPERATOR.value, AT.toString(), AT.toString()),
    ).toThrow();
  });

  it('refuses a THIRD tare source', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO container_assignments
             (component_id, container_id, container_type, tare_weight,
              tare_unit, tare_source, assignment_method, operator_id,
              assigned_at, scale_id, recorded_at)
           VALUES (?, 'C-12', 'DRUM', '214.0000', 'g',
                   'GUESSED', 'SCAN', ?, ?, NULL, ?)`,
        )
        .run(COMPONENT.value, OPERATOR.value, AT.toString(), AT.toString()),
    ).toThrow();
  });

  it('refuses a THIRD container type', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO container_assignments
             (component_id, container_id, container_type, tare_weight,
              tare_unit, tare_source, assignment_method, operator_id,
              assigned_at, scale_id, recorded_at)
           VALUES (?, 'C-12', 'PAIL', '214.0000', 'g',
                   'CONTAINER_MASTER', 'SCAN', ?, ?, NULL, ?)`,
        )
        .run(COMPONENT.value, OPERATOR.value, AT.toString(), AT.toString()),
    ).toThrow();
  });

  // ── The newest row is the effective one ──

  it('the newest assignment is effective, and the older is RETAINED', async () => {
    await assignments.save(assignment('C-12', '214.0000'));
    await assignments.save(assignment('C-12', '220.0000'));

    const read = await assignments.latestFor(COMPONENT);
    expect(read?.tareWeight.text).toBe('220.0000');

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM container_assignments`)
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('the same container for two components is NOT de-duplicated', async () => {
    await assignments.save(assignment('C-12'));
    await assignments.save(
      new ContainerAssignment(
        ComponentId.create('DYE-4471-B'),
        ContainerId.create('C-12'),
        'DRUM',
        WeightValue.of('214.0000', 'g'),
        'CONTAINER_MASTER',
        'KEYED_IN',
        OPERATOR,
        AT,
        ScaleId.create('SCALE-A'),
      ),
    );

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM container_assignments`)
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('the insertion sequence breaks the tie when two rows land together', async () => {
    await assignments.save(assignment('C-12', '214.0000'));
    await assignments.save(assignment('C-12', '220.0000'));

    const read = await assignments.latestFor(COMPONENT);
    expect(read?.tareWeight.text).toBe('220.0000');
  });

  // ── The master is UPDATABLE — and that is the point ──

  it('the master is READ-ONLY? No — the master is UPDATABLE', async () => {
    master.add(
      new Container(
        ContainerId.create('C-12'),
        'DRUM',
        WeightValue.of('214.0000', 'g'),
        true,
      ),
    );

    const before = await master.read(ContainerId.create('C-12'));
    expect(before.kind).toBe('FOUND');
    if (before.kind !== 'FOUND') return;
    expect(before.container.tareWeight?.text).toBe('214.0000');

    // The master's known tare CHANGES — a container is re-weighed, and
    // that is a fact about the container, not about a weighing.
    await master.setKnownTare(
      ContainerId.create('C-12'),
      WeightValue.of('220.0000', 'g'),
    );

    const after = await master.read(ContainerId.create('C-12'));
    expect(after.kind).toBe('FOUND');
    if (after.kind !== 'FOUND') return;
    expect(after.container.tareWeight?.text).toBe('220.0000');
  });

  it('the master’s tare may be CLEARED — null means "we do not know"', async () => {
    master.add(
      new Container(
        ContainerId.create('C-12'),
        'DRUM',
        WeightValue.of('214.0000', 'g'),
        true,
      ),
    );

    await master.setKnownTare(ContainerId.create('C-12'), null);

    const read = await master.read(ContainerId.create('C-12'));
    expect(read.kind).toBe('FOUND');
    if (read.kind !== 'FOUND') return;
    expect(read.container.tareWeight).toBeNull();
    expect(read.container.hasKnownTare).toBe(false);
  });

  it('the master holds a tare of ZERO as a KNOWN tare', async () => {
    master.add(
      new Container(
        ContainerId.create('C-00'),
        'DRUM',
        WeightValue.of('0.0000', 'g'),
        true,
      ),
    );

    const read = await master.read(ContainerId.create('C-00'));
    expect(read.kind).toBe('FOUND');
    if (read.kind !== 'FOUND') return;
    expect(read.container.hasKnownTare).toBe(true);
    expect(read.container.tareWeight?.text).toBe('0.0000');
  });

  it('the master reports a MISS as a state, not a failure', async () => {
    const read = await master.read(ContainerId.create('NOPE'));
    expect(read.kind).toBe('NOT_FOUND');
  });

  it('the master can take a container out of service', async () => {
    master.add(
      new Container(
        ContainerId.create('C-12'),
        'DRUM',
        WeightValue.of('214.0000', 'g'),
        true,
      ),
    );

    await master.setInService(ContainerId.create('C-12'), false);

    const read = await master.read(ContainerId.create('C-12'));
    expect(read.kind).toBe('FOUND');
    if (read.kind !== 'FOUND') return;
    expect(read.container.inService).toBe(false);
  });

  // ── The seed ──

  it('the seed covers BOTH routes — a known tare and none', async () => {
    master.seedSync();

    const known = await master.read(ContainerId.create('C-12'));
    expect(known.kind).toBe('FOUND');
    if (known.kind !== 'FOUND') return;
    expect(known.container.tareWeight?.text).toBe('214.0000');

    const unknown = await master.read(ContainerId.create('D-03'));
    expect(unknown.kind).toBe('FOUND');
    if (unknown.kind !== 'FOUND') return;
    expect(unknown.container.tareWeight).toBeNull();
  });

  it('the seed is idempotent', async () => {
    master.seedSync();
    master.seedSync();

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM containers`)
      .get() as { n: number };
    expect(count.n).toBe(5);
  });
});
