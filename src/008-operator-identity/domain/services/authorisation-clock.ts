/**
 * AuthorisationClock — the injected time source.
 *
 * WHY THE CLOCK IS INJECTED
 * --------------------------
 * Expiry is a core rule here, and a rule that reads an ambient clock
 * (`Date.now()`) cannot be tested AT ITS BOUNDARY. The story says "the
 * authorisation is presented at the exact expiry boundary → Refused —
 * expiry is inclusive of the expiry instant". Testing that exactly
 * requires controlling the clock.
 *
 * Production injects a system clock; tests inject a fixed or controllable
 * one. The clock is a port, not a utility, precisely so the boundary is a
 * *tested fact* rather than an assertion in a comment.
 *
 * This is a testability mechanism, not an architectural decision — the
 * pattern is already established by bolt 001's `SessionPolicy`.
 */
export interface AuthorisationClock {
  now(): Date;
}

/** The production clock — the system time. */
export class SystemAuthorisationClock implements AuthorisationClock {
  now(): Date {
    return new Date();
  }
}

/**
 * A clock that returns a fixed instant.
 *
 * For tests. `advance` moves it forward, so the expiry boundary can be
 * approached exactly rather than approximated with a sleep.
 */
export class FixedAuthorisationClock implements AuthorisationClock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(at: Date): void {
    this.current = new Date(at.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
