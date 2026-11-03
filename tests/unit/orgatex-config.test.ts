/**
 * The OrgaTEX configuration.
 *
 * The freshness window is the one setting that matters here, and its
 * behaviour at the edges is worth proving: a mistyped value must not stop
 * the station starting.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  loadOrgatexConfig,
} from '../../src/005-orgatex-integration/infrastructure/config/orgatex-config.js';

describe('the OrgaTEX configuration', () => {
  it('reads the database path from the environment', () => {
    const config = loadOrgatexConfig({
      WEIGHINGMS_DATABASE_PATH: '/var/lib/weighingms.sqlite',
    } as NodeJS.ProcessEnv);
    expect(config.databasePath).toBe('/var/lib/weighingms.sqlite');
  });

  it('falls back to a default database path', () => {
    const config = loadOrgatexConfig({} as NodeJS.ProcessEnv);
    expect(config.databasePath).toBe('./data/weighingms.sqlite');
  });

  it('reads the freshness window from the environment', () => {
    const config = loadOrgatexConfig({
      WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS: '90000',
    } as NodeJS.ProcessEnv);
    expect(config.freshnessWindowMs).toBe(90_000);
  });

  it('uses the default freshness window when none is given', () => {
    const config = loadOrgatexConfig({} as NodeJS.ProcessEnv);
    expect(config.freshnessWindowMs).toBe(DEFAULT_FRESHNESS_WINDOW_MS);
  });

  it('falls back on a MISTYPED freshness window rather than refusing to start', () => {
    // A typo must not make the station unweighable. The window's effect
    // is to serve a snapshot marked with its age — so a mistyped window
    // produces a visibly-aged snapshot, not a wrong number.
    for (const mistyped of ['not-a-number', '', '   ', '0', '-1', '12.5.6']) {
      const config = loadOrgatexConfig({
        WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS: mistyped,
      } as NodeJS.ProcessEnv);
      expect(config.freshnessWindowMs).toBe(DEFAULT_FRESHNESS_WINDOW_MS);
    }
  });

  it('reads the source name from the environment', () => {
    const config = loadOrgatexConfig({
      WEIGHINGMS_ORGATEX_SOURCE: 'SETEX_MES',
    } as NodeJS.ProcessEnv);
    expect(config.sourceName).toBe('SETEX_MES');
  });

  it('defaults the source name to the Dummy MES', () => {
    const config = loadOrgatexConfig({} as NodeJS.ProcessEnv);
    expect(config.sourceName).toBe('DUMMY_ORGATEX');
  });

  it('has a freshness window that is neither zero nor infinite', () => {
    // Zero would leave the DEGRADED read with nothing to serve; infinite
    // would let a snapshot from last week be presented as a schedule.
    expect(DEFAULT_FRESHNESS_WINDOW_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_FRESHNESS_WINDOW_MS)).toBe(true);
  });

  // ── The rejection disposition (CQ-06) ──

  it('reads the rejection disposition from the environment', () => {
    const config = loadOrgatexConfig({
      WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION: 'PERMANENT',
    } as NodeJS.ProcessEnv);
    expect(config.rejectionDisposition).toBe('PERMANENT');
  });

  it('defaults the rejection disposition to RETRYABLE', () => {
    // The default is the safer of the two behaviours — a loud failure
    // rather than a silently lost consumption (ADR-026).
    const config = loadOrgatexConfig({} as NodeJS.ProcessEnv);
    expect(config.rejectionDisposition).toBe('RETRYABLE');
  });

  it('falls back on a MISTYPED rejection disposition rather than refusing to start', () => {
    for (const mistyped of ['maybe', '', '   ', 'FINAL', 'retryable']) {
      const config = loadOrgatexConfig({
        WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION: mistyped,
      } as NodeJS.ProcessEnv);
      expect(config.rejectionDisposition).toBe('RETRYABLE');
    }
  });

  it('accepts a rejection disposition in any case', () => {
    const config = loadOrgatexConfig({
      WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION: 'permanent',
    } as NodeJS.ProcessEnv);
    expect(config.rejectionDisposition).toBe('PERMANENT');
  });
});
