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
 *
 * THE SELECTION THRESHOLD IS UNSET BY DEFAULT (ADR-019)
 * ---------------------------------------------------
 * `Q-04` asks FCI production for the scale-selection threshold and the
 * boundary behaviour, and `A-06` binds the story until it is answered.
 * So the threshold is a CONFIGURATION VALUE THAT IS CURRENTLY ABSENT —
 * and the selection rule works fully without it, because the capacity
 * constraint alone decides every case the story names.
 *
 * It is deliberately NOT defaulted to 3000 g. A hard-coded threshold
 * would be an invented answer to an open question, one that merely
 * coincides with the precision scale's capacity today — and a value
 * that is right by coincidence gets trusted as if it were right by
 * decision.
 *
 * When FCI answers, it is set here — in the composition root, which is
 * where configuration enters — and the domain does not change.
 */
import { WeightValue } from '../../domain/value-objects/weight-value.js';

export interface ScaleConfig {
  /** The disconnect timeout in milliseconds. IR-13: 2000. */
  readonly disconnectTimeoutMs: number;
  /** The sampling interval in milliseconds. IR-10: ≤ 100. */
  readonly sampleIntervalMs: number;
  /** The SQLite path — shared with the identity unit. */
  readonly databasePath: string;
  /**
   * The scale-selection threshold, or null while `Q-04` is unanswered.
   *
   * Null means "no threshold has been configured", which is a DIFFERENT
   * fact from "the threshold is zero" — the same distinction the tare
   * makes between "no tare in force" and "a tare of exactly zero".
   */
  readonly selectionThreshold: WeightValue | null;
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
    selectionThreshold: readThreshold(
      env['WEIGHINGMS_SCALE_SELECTION_THRESHOLD'],
    ),
  };
}

/**
 * Read the optional selection threshold from the environment.
 *
 * A malformed value is REFUSED, not silently ignored: a typo in the
 * threshold would send every component to the wrong scale, and a silent
 * fallback would hide the typo. The unit string is required alongside
 * the value, because a bare number's unit is a guess.
 */
function readThreshold(raw: string | undefined): WeightValue | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/.exec(raw.trim());
  if (match === null) {
    throw new Error(
      'WEIGHINGMS_SCALE_SELECTION_THRESHOLD must be "<number><unit>", e.g. "3000g"',
    );
  }

  const [, value, unit] = match;
  return WeightValue.of(value as string, (unit as string).toLowerCase());
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
