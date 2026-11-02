/**
 * ScaleDeviceRepository — the device REGISTRY.
 *
 * ADR-009: there is deliberately NO reading repository. Readings are
 * live-only, and the ABSENCE of this interface is what makes that rule
 * structural — there is nothing to accidentally call that would write a
 * reading down.
 *
 * The repository holds CONFIGURATION — which scales exist, their
 * capability and their calibration. It does NOT hold status: the status is
 * live state, and persisting it would let a stale status be read back
 * after a restart.
 */
import type { ScaleDevice } from '../entities/scale-device.js';
import type { ScaleId } from '../value-objects/scale-id.js';

export interface ScaleDeviceRepository {
  get(scaleId: ScaleId): Promise<ScaleDevice | null>;
  list(): Promise<ScaleDevice[]>;
  save(device: ScaleDevice): Promise<void>;
}
