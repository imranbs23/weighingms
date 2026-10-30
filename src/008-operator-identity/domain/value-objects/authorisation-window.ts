/**
 * AuthorisationWindow — the validity period of an authorisation.
 *
 * INVARIANT A-5: the authorisation expires. At `expiresAt` EXACTLY, it is
 * already invalid.
 *
 * THE BOUNDARY IS INCLUSIVE
 * -------------------------
 * `now >= expiresAt` means expired. This matches `SessionPolicy`, which
 * evaluates the session boundary the same way. An authorisation that was
 * still live at the instant of expiry would be live for one instant too
 * many.
 *
 * THE LENGTH IS CONFIGURATION, NOT A CONSTANT
 * -------------------------------------------
 * The story fixes THAT an authorisation expires but not HOW LONG it lives.
 * The window is therefore constructed from an injected lifetime rather than
 * a hard-coded duration, so the operational question can be answered
 * without a rebuild (FR-22, NFR-14).
 */
export class AuthorisationWindow {
  private constructor(
    readonly authorisedAt: Date,
    readonly expiresAt: Date,
  ) {}

  static of(authorisedAt: Date, expiresAt: Date): AuthorisationWindow {
    if (authorisedAt.getTime() >= expiresAt.getTime()) {
      throw new Error('Authorisation window must expire after it was authorised');
    }
    return new AuthorisationWindow(authorisedAt, expiresAt);
  }

  /**
   * A window starting now and lasting `lifetimeMs`.
   *
   * A non-positive lifetime is rejected rather than producing a window
   * that is already expired — an authorisation that expires the instant it
   * is created is a configuration error, not a valid authorisation.
   */
  static startingAt(authorisedAt: Date, lifetimeMs: number): AuthorisationWindow {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
      throw new Error('Authorisation lifetime must be a positive number of milliseconds');
    }
    return AuthorisationWindow.of(
      authorisedAt,
      new Date(authorisedAt.getTime() + lifetimeMs),
    );
  }

  /** True when the authorisation is still live at `at`. */
  isLiveAt(at: Date): boolean {
    return at.getTime() < this.expiresAt.getTime();
  }

  /** True when the authorisation has expired at `at` (inclusive boundary). */
  isExpiredAt(at: Date): boolean {
    return at.getTime() >= this.expiresAt.getTime();
  }
}
