/**
 * WeightSnapshot — the current weight OR the fact that there is none.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS TYPE IS THE EXPRESSION OF S-1.
 * ══════════════════════════════════════════════════════════════════════
 *
 * "No reading" and "a reading of zero" must never be confused. A silent
 * scale is not a scale reading zero: `0.0` is a legitimate under-dose
 * reading that the operator would be asked to act on. If a missing reading
 * were rendered as a zero, the operator would be told to keep pouring into
 * a scale that is not there.
 *
 * The `NONE` branch has NO VALUE FIELD AT ALL. There is nothing to render
 * as `0.0`, because there is no value to render. A caller cannot write
 * `snapshot.value` without first proving a reading exists — the compiler
 * enforces the distinction that the story requires.
 *
 * The `NONE` branch carries WHY there is no reading and SINCE WHEN, so
 * the UI can say "scale gone since 07:41:02" rather than showing a stale
 * number or a zero.
 */
import { ScaleReading } from './scale-reading.js';

export type NoReadingReason = 'NEVER_READ' | 'DISCONNECTED';

export type WeightSnapshot =
  | { readonly kind: 'READING'; readonly reading: ScaleReading }
  | {
      readonly kind: 'NONE';
      readonly since: Date;
      readonly reason: NoReadingReason;
    };

export function readingSnapshot(reading: ScaleReading): WeightSnapshot {
  return { kind: 'READING', reading };
}

export function noReadingSnapshot(
  since: Date,
  reason: NoReadingReason,
): WeightSnapshot {
  return { kind: 'NONE', since, reason };
}
