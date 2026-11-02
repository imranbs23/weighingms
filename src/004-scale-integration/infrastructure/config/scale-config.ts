/**
 * ScaleConfig — the scale unit's configuration.
 *
 * Every value here is a PARAMETER of a rule rather than a constant buried
 * in an implementation, so the operational questions can be answered
 * without a rebuild.
 *
 * The disconnect timeout defaults to 2000 ms because IR-13 requires
 * detection within 2 seconds. The sample interval defaults to 100 ms
 * because IR-10 requires at least 10 readings per second — and NFR-01's
 * 200 ms end-to-end budget splits into 100 ms sampling and 100 ms
 * transport, processing and render.
 */
export interface ScaleConfig {
  /** The disconnect timeout in milliseconds. IR-13: 2000. */
  readonly disconnectTimeoutMs: number;
  /** The sampling interval in milliseconds. IR-10: ≤ 100. */
  readonly sampleIntervalMs: number;
  /** The SQLite path — shared with the identity unit. */
  readonly databasePath: string;
}

export const DEFAULT_DISCONNECT_TIMEOUT_MS = 2000;
export const DEFAULT_SAMPLE_INTERVAL_MS = 100;

export function loadScaleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ScaleConfig {
  return {
    disconnectTimeoutMs: readInt(
      env['WEIGHINGMS_DISCONNECT_TIMEOUT_MS'],
      DEFAULT_DISCONNECT_TIMEOUT_MS,
    ),
    sampleIntervalMs: readInt(
      env['WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS'],
      DEFAULT_SAMPLE_INTERVAL_MS,
    ),
    databasePath:
      env['WEIGHINGMS_DATABASE_PATH'] ?? './data/weighingms.sqlite',
  };
}

function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
