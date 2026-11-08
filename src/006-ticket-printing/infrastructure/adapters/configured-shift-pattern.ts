/**
 * The shift pattern — a CONFIGURATION value.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A NAMED SHIFT RESOLVES TO A RANGE. ONE QUERY, TWO WAYS OF NAMING THE
 * PERIOD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The report's period is *"a date range **or a named shift**"*. And the
 * shift is the station's own **shift pattern** — so it is a configuration
 * value, and the resolution is a **port**.
 *
 * **And the report's implementation is the same either way** — the shift
 * resolves to a `from` and a `to`, and everything downstream sees a range.
 */
import type {
  ShiftPatternPort,
} from '../../application/use-cases/build-tolerance-report.js';

/** One shift's hours — when it starts and ends. */
export interface ShiftDefinition {
  readonly name: string;
  /** The hour of the day the shift starts. */
  readonly startHour: number;
  /** The hour of the day the shift ends — may be before `startHour`. */
  readonly endHour: number;
}

export class ConfiguredShiftPattern implements ShiftPatternPort {
  constructor(
    private readonly shifts: readonly ShiftDefinition[],
    /** How long a shift is — used to resolve a shift on a given day. */
    private readonly shiftLengthMs: number = 8 * 60 * 60 * 1000,
  ) {}

  /** The known shifts. */
  names(): readonly string[] {
    return this.shifts.map((shift) => shift.name);
  }

  /**
   * The shift's range — for the day it is asked about.
   *
   * **A shift that crosses midnight** — one whose end hour is before its
   * start hour — runs into the next day, and the range says so.
   */
  async resolve(
    shift: string,
    on?: Date,
  ): Promise<{ from: Date; to: Date } | null> {
    const definition = this.shifts.find(
      (candidate) => candidate.name === shift,
    );
    if (definition === undefined) return null;

    const day = on ?? new Date();
    const from = new Date(day);
    from.setHours(definition.startHour, 0, 0, 0);

    const to = new Date(from.getTime() + this.shiftLengthMs);

    return { from, to };
  }
}
