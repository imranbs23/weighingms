/**
 * Unit tests for the identity configuration.
 *
 * The session lifetime is a configuration value rather than a constant
 * because CQ-02 — whether identity is established per shift or per
 * weighing — is unresolved. That unresolved question is only safe to carry
 * as long as the value is genuinely settable, so these tests assert that
 * it IS settable, and that a malformed setting is REJECTED rather than
 * silently defaulted.
 *
 * A silently-defaulted bad value is the dangerous case: a typo in a
 * deployment's environment variable would produce a session lifetime of
 * zero (or of NaN) and every sign-in would fail in production, with no
 * error at startup to explain why.
 */
import { describe, it, expect } from 'vitest';
import {
  loadIdentityConfig,
  DEFAULT_SESSION_LIFETIME_MS,
} from '../../src/008-operator-identity/infrastructure/config/identity-config.js';

describe('identity configuration', () => {
  it('defaults to an eight-hour shift', () => {
    expect(DEFAULT_SESSION_LIFETIME_MS).toBe(8 * 60 * 60 * 1000);
  });

  it('uses the documented defaults when the environment is empty', () => {
    const config = loadIdentityConfig({});

    expect(config.databasePath).toBe('./data/weighingms.sqlite');
    expect(config.sessionLifetimeMs).toBe(DEFAULT_SESSION_LIFETIME_MS);
    expect(config.argon2Memory).toBe(19456);
    expect(config.argon2Passes).toBe(2);
  });

  it('reads the database path from the primary variable', () => {
    const config = loadIdentityConfig({ WEIGHINGMS_DB_PATH: '/tmp/a.sqlite' });
    expect(config.databasePath).toBe('/tmp/a.sqlite');
  });

  it('falls back to the legacy database variable', () => {
    const config = loadIdentityConfig({ DATABASE_PATH: '/tmp/legacy.sqlite' });
    expect(config.databasePath).toBe('/tmp/legacy.sqlite');
  });

  it('prefers the primary database variable over the legacy one', () => {
    const config = loadIdentityConfig({
      WEIGHINGMS_DB_PATH: '/tmp/primary.sqlite',
      DATABASE_PATH: '/tmp/legacy.sqlite',
    });
    expect(config.databasePath).toBe('/tmp/primary.sqlite');
  });

  it('reads the session lifetime from the environment', () => {
    const config = loadIdentityConfig({
      WEIGHINGMS_SESSION_LIFETIME_MS: '3600000',
    });
    expect(config.sessionLifetimeMs).toBe(3_600_000);
  });

  it('reads the Argon2 cost from the environment', () => {
    const config = loadIdentityConfig({
      WEIGHINGMS_ARGON2_MEMORY: '8192',
      WEIGHINGMS_ARGON2_PASSES: '1',
    });
    expect(config.argon2Memory).toBe(8192);
    expect(config.argon2Passes).toBe(1);
  });

  it('treats an EMPTY value as absent, using the default', () => {
    const config = loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: '' });
    expect(config.sessionLifetimeMs).toBe(DEFAULT_SESSION_LIFETIME_MS);
  });

  it('treats a WHITESPACE-ONLY value as absent', () => {
    const config = loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: '   ' });
    expect(config.sessionLifetimeMs).toBe(DEFAULT_SESSION_LIFETIME_MS);
  });

  it('REJECTS a non-numeric value rather than silently defaulting', () => {
    expect(() =>
      loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: 'eight hours' }),
    ).toThrow(/Invalid numeric configuration value/);
  });

  it('REJECTS a zero value — a zero lifetime would break every sign-in', () => {
    expect(() =>
      loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: '0' }),
    ).toThrow(/Invalid numeric configuration value/);
  });

  it('REJECTS a negative value', () => {
    expect(() =>
      loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: '-1' }),
    ).toThrow(/Invalid numeric configuration value/);
  });

  it('REJECTS a malformed Argon2 memory value', () => {
    expect(() =>
      loadIdentityConfig({ WEIGHINGMS_ARGON2_MEMORY: 'lots' }),
    ).toThrow(/Invalid numeric configuration value/);
  });

  it('rejects a malformed Argon2 pass count', () => {
    expect(() =>
      loadIdentityConfig({ WEIGHINGMS_ARGON2_PASSES: 'many' }),
    ).toThrow(/Invalid numeric configuration value/);
  });

  it('floors a fractional value rather than storing a fraction', () => {
    // A fractional millisecond lifetime is a typo. Flooring it keeps the
    // value an integer, which is what the rest of the system assumes.
    const config = loadIdentityConfig({ WEIGHINGMS_SESSION_LIFETIME_MS: '1000.9' });
    expect(config.sessionLifetimeMs).toBe(1000);
  });
});
