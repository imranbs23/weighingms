/**
 * The composition root — where the scale unit's layers are wired.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE Q-03 SEAM IS BOUND HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `DummyScaleAdapter` is bound to the `ScaleAdapter` port. When FCI
 * confirms the indicator's protocol, this is the line that changes — plus
 * one new adapter class. Nothing else in the product changes.
 *
 * THE DEVICES ARE SEEDED HERE
 * ---------------------------
 * The two scales come from the prototype's own status strip:
 *
 *   SCALE-A — precision, 3 kg, 1 g    — dyestuffs
 *   SCALE-B — floor,    32 kg, 10 g   — dry auxiliaries
 *
 * The capacities are read from the prototype; the RULE for choosing
 * between them belongs to bolt 004. This unit provides the facts.
 */
import { randomUUID } from 'node:crypto';
import { ScaleRegistry } from '../domain/services/scale-registry.js';
import { ScaleStreamService } from '../domain/services/scale-stream-service.js';
import { LinkWatchdog } from '../domain/services/link-watchdog.js';
import { ScaleHealthPolicy } from '../domain/services/scale-health-policy.js';
import { ScaleDevice } from '../domain/entities/scale-device.js';
import { ScaleId } from '../domain/value-objects/scale-id.js';
import { WeightValue } from '../domain/value-objects/weight-value.js';
import {
  ScaleCapability,
  type ScaleClass,
} from '../domain/value-objects/scale-capability.js';
import type { ScaleEvent } from '../domain/events/scale-events.js';
import type { ScaleAdapter } from '../domain/ports/scale-adapter.js';
import { DummyScaleAdapter } from './adapters/dummy-scale-adapter.js';
import { NodeWatchdogScheduler } from './adapters/node-watchdog-scheduler.js';
import { SqliteScaleDeviceRepository } from './persistence/sqlite-scale-device-repository.js';
import { SqliteDeviceLinkHistoryRepository } from './persistence/sqlite-device-link-history-repository.js';
import { openScaleDatabase, type SqliteDatabase } from './persistence/scale-database.js';
import type { ScaleConfig } from './config/scale-config.js';

export interface ScaleModule {
  readonly db: SqliteDatabase;
  readonly registry: ScaleRegistry;
  readonly streams: ScaleStreamService;
  readonly health: ScaleHealthPolicy;
  readonly adapters: Map<string, ScaleAdapter>;
  readonly deviceRepository: SqliteScaleDeviceRepository;
  readonly historyRepository: SqliteDeviceLinkHistoryRepository;
  close(): void;
}

export interface BuildScaleOptions {
  readonly config: ScaleConfig;
  readonly clock?: () => Date;
  /** An existing database, so the two units can share one file. */
  readonly db?: SqliteDatabase;
  readonly onEvent?: (event: ScaleEvent) => void;
}

/** The two devices, from the prototype's status strip. */
const DEVICE_SEED: readonly {
  id: string;
  label: string;
  scaleClass: ScaleClass;
  capacity: string;
  resolution: string;
  unit: string;
}[] = [
  {
    id: 'SCALE-A',
    label: '3 kg precision',
    scaleClass: 'PRECISION',
    capacity: '3000',
    resolution: '1',
    unit: 'g',
  },
  {
    id: 'SCALE-B',
    label: '32 kg floor',
    scaleClass: 'FLOOR',
    capacity: '32000',
    resolution: '10',
    unit: 'g',
  },
];

export function buildScaleModule(options: BuildScaleOptions): ScaleModule {
  const { config } = options;
  const clock = options.clock ?? (() => new Date());

  // The scale unit's migrations are applied EVEN when an existing
  // database is supplied — otherwise the tables the repositories read
  // would never exist. `openScaleDatabase` applies the migrations to the
  // supplied handle and returns it.
  const db = openScaleDatabase(config.databasePath, options.db);

  const deviceRepository = new SqliteScaleDeviceRepository(db);
  const historyRepository = new SqliteDeviceLinkHistoryRepository(db);

  const watchdog = new LinkWatchdog(config.disconnectTimeoutMs);
  const scheduler = new NodeWatchdogScheduler();
  const health = new ScaleHealthPolicy();
  const streams = new ScaleStreamService();

  const adapters = new Map<string, ScaleAdapter>();

  const registry = new ScaleRegistry({
    watchdog,
    scheduler,
    devices: deviceRepository,
    history: historyRepository,
    clock,
    onEvent: options.onEvent,
    adapters: adapters as Map<
      string,
      { silence?: () => void; unsilence?: () => void }
    >,
  });

  for (const seed of DEVICE_SEED) {
    const scaleId = ScaleId.create(seed.id);

    // The calibration is valid for a year — long enough that the training
    // build is not immediately blocked, and short enough that the expired
    // path is reachable by changing one value.
    const calibration = {
      kind: 'IN_CALIBRATION' as const,
      expiresAt: new Date(clock().getTime() + 365 * 24 * 60 * 60 * 1000),
    };

    const device = new ScaleDevice(
      scaleId,
      seed.label,
      new ScaleCapability(
        seed.scaleClass,
        WeightValue.of(seed.capacity, seed.unit),
        WeightValue.of(seed.resolution, seed.unit),
      ),
      calibration,
      clock(),
    );

    registry.register(device);
    void deviceRepository.save(device);

    const adapter = new DummyScaleAdapter(
      {
        scaleId,
        unit: seed.unit,
        sampleIntervalMs: config.sampleIntervalMs,
        idleWeight: '0',
        status: 'CONNECTED',
        calibration,
      },
      clock,
    );
    adapters.set(seed.id, adapter);
  }

  return {
    db,
    registry,
    streams,
    health,
    adapters,
    deviceRepository,
    historyRepository,
    close() {
      scheduler.dispose();
      for (const adapter of adapters.values()) {
        if (adapter instanceof DummyScaleAdapter) {
          adapter.stop();
        }
      }
      if (options.db === undefined) {
        db.close();
      }
    },
  };
}

export { randomUUID };
