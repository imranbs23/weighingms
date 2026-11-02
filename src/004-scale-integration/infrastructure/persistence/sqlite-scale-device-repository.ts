/**
 * SqliteScaleDeviceRepository — the device REGISTRY.
 *
 * Holds CONFIGURATION only: which scales exist, their capability and
 * their calibration.
 *
 * IT DOES NOT HOLD STATUS. The status is live state, held in memory by
 * the aggregate. Persisting it would let a stale status be read back
 * after a restart — the same failure mode the missing reading repository
 * prevents (ADR-009).
 *
 * Every value is BOUND as a parameter. No SQL is built by string
 * concatenation anywhere in this class.
 */
import type {
  ScaleDeviceRepository,
} from '../../domain/ports/scale-device-repository.js';
import { ScaleDevice } from '../../domain/entities/scale-device.js';
import { ScaleId } from '../../domain/value-objects/scale-id.js';
import { WeightValue } from '../../domain/value-objects/weight-value.js';
import {
  ScaleCapability,
  type ScaleClass,
} from '../../domain/value-objects/scale-capability.js';
import type { CalibrationState } from '../../domain/value-objects/calibration-state.js';
import type { SqliteDatabase } from './scale-database.js';

interface ScaleDeviceRow {
  id: string;
  label: string;
  class: string;
  capacity: string;
  resolution: string;
  unit: string;
  calibration_state: string;
  calibration_expires_at: string | null;
}

export class SqliteScaleDeviceRepository implements ScaleDeviceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async get(scaleId: ScaleId): Promise<ScaleDevice | null> {
    const row = this.db
      .prepare('SELECT * FROM scale_devices WHERE id = ?')
      .get(scaleId.value) as unknown as ScaleDeviceRow | undefined;
    return row === undefined ? null : this.toDevice(row);
  }

  async list(): Promise<ScaleDevice[]> {
    const rows = this.db
      .prepare('SELECT * FROM scale_devices ORDER BY id')
      .all() as unknown as ScaleDeviceRow[];
    return rows.map((row) => this.toDevice(row));
  }

  async save(device: ScaleDevice): Promise<void> {
    const calibration = device.calibrationState;
    this.db
      .prepare(
        `INSERT INTO scale_devices
           (id, label, class, capacity, resolution, unit,
            calibration_state, calibration_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           class = excluded.class,
           capacity = excluded.capacity,
           resolution = excluded.resolution,
           unit = excluded.unit,
           calibration_state = excluded.calibration_state,
           calibration_expires_at = excluded.calibration_expires_at`,
      )
      .run(
        device.id.value,
        device.label,
        device.capability.scaleClass,
        device.capability.capacity.text,
        device.capability.resolution.text,
        device.capability.capacity.unit,
        calibration.kind,
        calibration.kind === 'IN_CALIBRATION'
          ? calibration.expiresAt.toISOString()
          : null,
      );
  }

  private toDevice(row: ScaleDeviceRow): ScaleDevice {
    const calibration: CalibrationState =
      row.calibration_state === 'IN_CALIBRATION' &&
      row.calibration_expires_at !== null
        ? { kind: 'IN_CALIBRATION', expiresAt: new Date(row.calibration_expires_at) }
        : { kind: 'EXPIRED' };

    return new ScaleDevice(
      ScaleId.create(row.id),
      row.label,
      new ScaleCapability(
        row.class as ScaleClass,
        WeightValue.of(row.capacity, row.unit),
        WeightValue.of(row.resolution, row.unit),
      ),
      calibration,
      new Date(),
    );
  }
}
