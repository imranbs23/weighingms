/**
 * The link state's derivation — the pure rule (bolt 007, R-01, R-02, R-06).
 *
 * Every case here is a case the story names. The derivation is a pure
 * function of its arguments, so the clock is an argument and the
 * boundary can be tested **exactly** rather than approximately.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { PureLinkStatePolicy } from '../../src/005-orgatex-integration/domain/services/link-state-policy.js';
import { FreshnessWindow } from '../../src/005-orgatex-integration/domain/value-objects/freshness-window.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  LINK_STATUSES,
  isLinkStatus,
} from '../../src/005-orgatex-integration/domain/value-objects/link-status.js';

const policy = new PureLinkStatePolicy();
const WINDOW = FreshnessWindow.of(300_000);

const at = (iso: string): Instant => Instant.of(new Date(iso));

const T0 = at('2026-10-30T08:00:00.000Z');

describe('FreshnessWindow', () => {
  it('accepts zero — R-06 names it as a legal configured value', () => {
    expect(FreshnessWindow.of(0).durationMs).toBe(0);
  });

  it('refuses a negative window', () => {
    expect(() => FreshnessWindow.of(-1)).toThrow(/must not be negative/);
  });

  it('refuses a fractional window', () => {
    expect(() => FreshnessWindow.of(1.5)).toThrow(/whole number/);
  });

  it('refuses a window that is not a finite number', () => {
    expect(() => FreshnessWindow.of(Number.NaN)).toThrow(/finite/);
    expect(() => FreshnessWindow.of(Number.POSITIVE_INFINITY)).toThrow(
      /finite/,
    );
  });

  it('names its own duration', () => {
    // The units are stated once, at the boundary — a bare number has no
    // units attached to it.
    expect(FreshnessWindow.of(300_000).toString()).toBe('300000ms');
  });

  it('includes the boundary inclusively', () => {
    expect(FreshnessWindow.of(100).includes(100)).toBe(true);
    expect(FreshnessWindow.of(100).includes(101)).toBe(false);
  });

  it('a window of zero includes only an age of zero', () => {
    expect(FreshnessWindow.of(0).includes(0)).toBe(true);
    expect(FreshnessWindow.of(0).includes(1)).toBe(false);
  });
});

describe('LinkStatus', () => {
  it('is a closed set of three', () => {
    expect([...LINK_STATUSES]).toEqual(['LINKED', 'DEGRADED', 'OFFLINE']);
  });

  it('rejects a status outside the set', () => {
    expect(isLinkStatus('LINKED')).toBe(true);
    expect(isLinkStatus('DEGRADED')).toBe(true);
    expect(isLinkStatus('OFFLINE')).toBe(true);
    expect(isLinkStatus('UP')).toBe(false);
    expect(isLinkStatus(undefined)).toBe(false);
  });
});

describe('PureLinkStatePolicy.derive', () => {
  it('is LINKED after a success — R-01', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: null,
        lastError: null,
        consecutiveFailures: 0,
      },
      T0,
      WINDOW,
    );

    expect(state.status).toBe('LINKED');
    expect(state.lastContactAt).toBe(T0);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('is OFFLINE for a station that has never contacted the MES', () => {
    // DEGRADED requires a LAST SUCCESSFUL CONTACT. There is none, so the
    // station has never been degraded — it has never been anything.
    const state = policy.derive(
      {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        consecutiveFailures: 0,
      },
      T0,
      WINDOW,
    );

    expect(state.status).toBe('OFFLINE');
    expect(state.lastContactAt).toBeNull();
  });

  it('is DEGRADED after one failure, with the snapshot still fresh', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: at('2026-10-30T08:00:01.000Z'),
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      at('2026-10-30T08:00:01.000Z'),
      WINDOW,
    );

    expect(state.status).toBe('DEGRADED');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError?.code).toBe('UNREACHABLE');
  });

  it('is OFFLINE once the snapshot has aged out of the window', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: at('2026-10-30T08:10:00.000Z'),
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      at('2026-10-30T08:10:00.000Z'),
      WINDOW,
    );

    expect(state.status).toBe('OFFLINE');
  });

  it('the freshness boundary is INCLUSIVE — DEGRADED at exactly the window', () => {
    // The boundary is exactly as the scale's LinkWatchdog's is: at
    // `now - lastSuccessAt === window.durationMs` the snapshot is still
    // servable.
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: T0,
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      T0.plus(300_000),
      WINDOW,
    );

    expect(state.status).toBe('DEGRADED');
  });

  it('one millisecond past the boundary is OFFLINE', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: T0,
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      T0.plus(300_001),
      WINDOW,
    );

    expect(state.status).toBe('OFFLINE');
  });

  it('a window of ZERO makes DEGRADED unreachable — R-06', () => {
    // "The freshness window is configured to zero → the state transitions
    // from DEGRADED to OFFLINE on the first failure."
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: T0,
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      T0,
      FreshnessWindow.of(0),
    );

    expect(state.status).toBe('OFFLINE');
  });

  it('a success resets the streak to LINKED — R-01', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: null,
        lastError: null,
        consecutiveFailures: 0,
      },
      T0,
      WINDOW,
    );

    expect(state.status).toBe('LINKED');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastError).toBeNull();
  });

  it('is DEGRADED however many failures there have been, while the snapshot is fresh', () => {
    const state = policy.derive(
      {
        lastSuccessAt: T0,
        lastFailureAt: T0,
        lastError: SyncError.of('TIMEOUT', 'timed out', 'detail'),
        consecutiveFailures: 7,
      },
      T0.plus(1000),
      WINDOW,
    );

    expect(state.status).toBe('DEGRADED');
    expect(state.consecutiveFailures).toBe(7);
  });

  it('is OFFLINE after a failure with NO last successful contact', () => {
    const state = policy.derive(
      {
        lastSuccessAt: null,
        lastFailureAt: T0,
        lastError: SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
        consecutiveFailures: 1,
      },
      T0,
      WINDOW,
    );

    expect(state.status).toBe('OFFLINE');
  });
});
