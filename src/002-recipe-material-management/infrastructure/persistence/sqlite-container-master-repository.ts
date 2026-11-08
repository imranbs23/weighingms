/**
 * SqliteContainerMasterRepository — WeighingMS's own container master.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ONE UPDATABLE TABLE THIS UNIT OWNS. AND THAT IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD §9.3 makes the container master **WeighingMS's** data — unlike the
 * recipe and the dyestuff master, which are OrgaTEX's. So it is a local
 * table rather than a seam over the MES.
 *
 * **And it is UPDATABLE**, because a container's known tare genuinely
 * changes — it is re-weighed, or it goes out of service — and that is a
 * fact about the **container**, not about a weighing.
 *
 * The distinction is the one the whole product turns on: **reference data
 * is maintained; the record of an act is not** (ADR-035). The assignment
 * table beside this one is append-only, with triggers.
 *
 * THE TARE IS NULLABLE HERE, AND NULL IS NOT ZERO
 * -----------------------------------------------
 * A container the master does not weigh has a **null** tare — and then the
 * empty container must be **weighed** instead. A tare of `0.0000` is a
 * real known tare, and unit `004` carries the same rule (S-12).
 */
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { Container } from '../../domain/entities/container.js';
import type { ContainerMasterSource } from '../../domain/ports/container-ports.js';
import {
  isContainerType,
  type ContainerType,
} from '../../domain/value-objects/container-type.js';
import { ContainerId } from '../../domain/value-objects/container-id.js';
import type { SqliteDatabase } from './container-database.js';
interface ContainerRow {
  container_id: string;
  container_type: string;
  tare_qty: string | null;
  tare_unit: string;
  in_service: number;
}

export class SqliteContainerMasterRepository implements ContainerMasterSource {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Seed the master with the containers the station has.
   *
   * The container master is **WeighingMS's own** data (BRD §9.3), so it is
   * seeded rather than read from the MES — and the seed is the prototype's
   * own containers, so the training artefact teaches the right thing
   * (Rule 5).
   *
   * The seed covers **both** cases the story names: a container whose tare
   * the master holds (`CONTAINER_MASTER`), and one it does not — which
   * must be **weighed empty** instead.
   */
  async seed(): Promise<void> {
    void this.seedSync();
  }

  /**
   * Seed the master — synchronously.
   *
   * SQLite is synchronous, so the seed needs no `await`, and the harness
   * needs it synchronously too.
   */
  seedSync(): void {
    const existing = this.db
      .prepare(`SELECT COUNT(*) AS n FROM containers`)
      .get() as { n: number };
    if (existing.n > 0) return;

    for (const seed of CONTAINER_SEED) {
      this.add(
        new Container(
          ContainerId.create(seed.id),
          seed.type,
          seed.tare === null
            ? null
            : WeightValue.of(seed.tare, seed.unit),
          true,
        ),
      );
    }
  }

  /**
   * Read a container from the master.
   *
   * A miss is **returned**, not thrown — a container the master does not
   * know is a state, not a failure.
   */
  async read(containerId: ContainerId): Promise<
    | { readonly kind: 'FOUND'; readonly container: Container }
    | { readonly kind: 'NOT_FOUND' }
  > {
    const row = this.db
      .prepare(`SELECT * FROM containers WHERE container_id = ?`)
      .get(containerId.value) as unknown as ContainerRow | undefined;

    if (row === undefined) return { kind: 'NOT_FOUND' };

    return { kind: 'FOUND', container: toContainer(row) };
  }

  /**
   * Set a container's known tare.
   *
   * The **master's** write — the one mutation this unit's master allows,
   * because a container's known weight changes when it is re-weighed.
   */
  async setKnownTare(
    containerId: ContainerId,
    tare: WeightValue | null,
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE containers
            SET tare_qty = ?, tare_unit = ?
          WHERE container_id = ?`,
      )
      .run(
        tare === null ? null : tare.toJSON(),
        tare === null ? '' : tare.unit,
        containerId.value,
      );

    return Number(result.changes) > 0;
  }

  /**
   * Take a container out of service — or put it back.
   */
  async setInService(
    containerId: ContainerId,
    inService: boolean,
  ): Promise<boolean> {
    const result = this.db
      .prepare(`UPDATE containers SET in_service = ? WHERE container_id = ?`)
      .run(inService ? 1 : 0, containerId.value);

    return Number(result.changes) > 0;
  }

  /**
   * Add a container to the master.
   *
   * The master is **seeded**, not authored — a container is a physical
   * object, and the master records the ones the station has.
   */
  add(container: Container): void {
    this.db
      .prepare(
        `INSERT INTO containers
           (container_id, container_type, tare_qty, tare_unit, in_service)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        container.containerId.value,
        container.containerType,
        container.tareWeight === null ? null : container.tareWeight.toJSON(),
        container.tareWeight === null ? '' : container.tareWeight.unit,
        container.inService ? 1 : 0,
      );
  }
}

/**
 * The containers the station has.
 *
 * The prototype's own containers — `C-09`, `C-11`, `C-12`, `D-03`, `D-05` —
 * so the training artefact teaches the right thing (Rule 5).
 *
 * **AND THE SEED COVERS BOTH ROUTES.** `C-12` holds a known tare of
 * `214 g`, so it is captured as `CONTAINER_MASTER`. `D-03` holds **none**,
 * so the empty container must be **weighed** — which is the other route,
 * and the one the story's edge cases exercise.
 */
const CONTAINER_SEED: readonly {
  readonly id: string;
  readonly type: ContainerType;
  readonly tare: string | null;
  readonly unit: string;
}[] = [
  { id: 'C-09', type: 'DRUM', tare: '214.0000', unit: 'g' },
  { id: 'C-11', type: 'DRUM', tare: '214.0000', unit: 'g' },
  { id: 'C-12', type: 'DRUM', tare: '214.0000', unit: 'g' },
  { id: 'D-03', type: 'BUCKET', tare: null, unit: 'g' },
  { id: 'D-05', type: 'BUCKET', tare: null, unit: 'g' },
];

/**
 * Rebuild a container from its row.
 *
 * The type is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toContainer(row: ContainerRow): Container {
  if (!isContainerType(row.container_type)) {
    throw new Error(
      `The stored container type "${row.container_type}" is not one this product records`,
    );
  }

  return new Container(
    ContainerId.create(row.container_id),
    row.container_type,
    row.tare_qty === null ? null : WeightValue.of(row.tare_qty, row.tare_unit),
    row.in_service === 1,
  );
}
