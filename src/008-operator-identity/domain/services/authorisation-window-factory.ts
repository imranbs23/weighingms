/**
 * AuthorisationWindowFactory — creates the validity window.
 *
 * THE LIFETIME IS CONFIGURATION, NOT A CONSTANT
 * ---------------------------------------------
 * The story fixes THAT an authorisation expires but not HOW LONG it lives.
 * The operational question of the right window length is open, and the
 * model must not settle it by accident. The lifetime is therefore injected,
 * exactly as `SessionLifetime` is in bolt 001.
 *
 * The factory exists so the window's construction is in ONE place — the
 * `authorisedAt < expiresAt` rule and the positive-lifetime rule both live
 * in `AuthorisationWindow`, and this factory is what applies the configured
 * duration to a start instant.
 */
import { AuthorisationWindow } from '../value-objects/authorisation-window.js';

export interface AuthorisationWindowFactory {
  create(authorisedAt: Date): AuthorisationWindow;
}

export class ConfiguredAuthorisationWindowFactory implements AuthorisationWindowFactory {
  constructor(private readonly lifetimeMs: number) {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
      throw new Error('Authorisation lifetime must be a positive number of milliseconds');
    }
  }

  create(authorisedAt: Date): AuthorisationWindow {
    return AuthorisationWindow.startingAt(authorisedAt, this.lifetimeMs);
  }
}
