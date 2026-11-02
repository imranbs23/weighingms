/**
 * Instant — a point in time, in whole milliseconds.
 *
 * Integer only. A floating-point timestamp would make the watchdog's
 * boundary decision fuzzy at exactly the point where the requirement says
 * it must be exact: "at exactly 2000 ms the link is still UP".
 *
 * This wraps `Date` rather than replacing it, because `Date` is what the
 * rest of the codebase (and `node:sqlite`, and `Date.prototype.toISOString`)
 * speaks.
 */
export class Instant {
  private constructor(readonly epochMillis: number) {}

  static of(date: Date): Instant {
    return new Instant(date.getTime());
  }

  static fromMillis(millis: number): Instant {
    if (!Number.isInteger(millis)) {
      throw new Error('Instant must be a whole number of milliseconds');
    }
    return new Instant(millis);
  }

  /** The number of milliseconds from `this` to `other`. */
  millisecondsUntil(other: Instant): number {
    return other.epochMillis - this.epochMillis;
  }

  plus(millis: number): Instant {
    return new Instant(this.epochMillis + millis);
  }

  toDate(): Date {
    return new Date(this.epochMillis);
  }

  toString(): string {
    return new Date(this.epochMillis).toISOString();
  }
}
