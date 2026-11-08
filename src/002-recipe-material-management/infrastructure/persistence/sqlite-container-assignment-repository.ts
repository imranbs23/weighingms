/**
 * SqliteContainerAssignmentRepository — the durable record of an
 * assignment.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO METHODS. NO UPDATE, NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no update path and no delete path here, so there is nothing that
 * *could* rewrite an assignment (BRD DR-02). The database's triggers are
 * the second line of the same guarantee — a repository convention holds
 * against a careless caller; a trigger holds against everyone (ADR-029,
 * ADR-034, ADR-035).
 *
 * THE EFFECTIVE ASSIGNMENT IS THE NEWEST ROW
 * ------------------------------------------
 * Not a flag, not a `superseded_at`. The ordering is **total**:
 * `assigned_at DESC, id DESC`. `assigned_at` alone is ambiguous when two
 * assignments land in the same millisecond, and "the latest" must have
 * exactly one answer — and a **re-tare is a new assignment**, not an
 * update.
 */
import { ContainerAssignment } from '../../domain/entities/container-assignment.js';
import type { ContainerAssignmentRepository } from '../../domain/ports/container-ports.js';
import {
  isAssignmentMethod,
} from '../../domain/value-objects/assignment-method.js';
import {
  isContainerType,
} from '../../domain/value-objects/container-type.js';
import { ContainerId } from '../../domain/value-objects/container-id.js';
import {
  ComponentId,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { TareSource } from '../../../004-scale-integration/domain/value-objects/tare-source.js';
import type { SqliteDatabase } from './container-database.js';

interface AssignmentRow {
  id: number;
  component_id: string;
  container_id: string;
  container_type: string;
  tare_weight: string;
  tare_unit: string;
  tare_source: string;
  assignment_method: string;
  operator_id: string;
  assigned_at: string;
  scale_id: string | null;
  recorded_at: string;
}

/** The closed set of tare sources, read back through the domain's guard. */
const TARE_SOURCES: readonly TareSource[] = [
  'CONTAINER_MASTER',
  'WEIGHED_EMPTY_CONTAINER',
];

function isTareSource(value: unknown): value is TareSource {
  return (
    typeof value === 'string' &&
    (TARE_SOURCES as readonly string[]).includes(value)
  );
}

export class SqliteContainerAssignmentRepository
  implements ContainerAssignmentRepository
{
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * INSERT ONLY.
   *
   * The row's identifier is assigned by the database — it is the
   * **insertion sequence**, and it is what breaks a tie when two
   * assignments land in the same millisecond.
   *
   * The `assigned_at` is the **act's** time while `recorded_at` is the
   * **write's** time — two different moments, kept apart deliberately.
   */
  async save(assignment: ContainerAssignment): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO container_assignments
           (component_id, container_id, container_type, tare_weight,
            tare_unit, tare_source, assignment_method, operator_id,
            assigned_at, scale_id, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assignment.componentId.value,
        assignment.containerId.value,
        assignment.containerType,
        assignment.tareWeight.toJSON(),
        assignment.tareWeight.unit,
        assignment.tareSource,
        assignment.assignmentMethod,
        assignment.assignedBy.value,
        assignment.assignedAt.toString(),
        assignment.scaleId === null ? null : assignment.scaleId.value,
        this.clock().toISOString(),
      );
  }

  /**
   * The newest assignment for a component — the effective one.
   *
   * `null` when no container has been assigned yet. An unassigned
   * component is a **state**, not an error.
   */
  async latestFor(
    componentId: ComponentId,
  ): Promise<ContainerAssignment | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM container_assignments
          WHERE component_id = ?
          ORDER BY assigned_at DESC, id DESC
          LIMIT 1`,
      )
      .get(componentId.value) as unknown as AssignmentRow | undefined;

    return row === undefined ? null : toAssignment(row);
  }
}

/**
 * Rebuild an assignment from its row.
 *
 * The closed sets are read back through the domain's own guards, so a row
 * that somehow held a value outside one of them would be **refused** rather
 * than silently carried into the model.
 */
function toAssignment(row: AssignmentRow): ContainerAssignment {
  if (!isAssignmentMethod(row.assignment_method)) {
    throw new Error(
      `The stored assignment method "${row.assignment_method}" is not one this product records`,
    );
  }
  if (!isContainerType(row.container_type)) {
    throw new Error(
      `The stored container type "${row.container_type}" is not one this product records`,
    );
  }
  if (!isTareSource(row.tare_source)) {
    throw new Error(
      `The stored tare source "${row.tare_source}" is not one this product records`,
    );
  }

  return new ContainerAssignment(
    ComponentId.create(row.component_id),
    ContainerId.create(row.container_id),
    row.container_type,
    WeightValue.of(row.tare_weight, row.tare_unit),
    row.tare_source,
    row.assignment_method,
    OperatorId.create(row.operator_id),
    Instant.of(new Date(row.assigned_at)),
    row.scale_id === null ? null : ScaleId.create(row.scale_id),
  );
}
