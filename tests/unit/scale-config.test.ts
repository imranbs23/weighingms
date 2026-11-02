/**
 * Unit tests for the SCALE configuration — bolt 004.
 *
 * WHY THE SELECTION THRESHOLD NEEDS ITS OWN TESTS
 * ----------------------------------------------
 * The threshold is CONFIGURATION (ADR-019), and it is unset while `Q-04` is
 * open. That makes it exactly the kind of value that breaks silently: a
 * typo in a deployment's environment variable would send every component
 * to the wrong scale, and nothing would say so until an operator weighed
 * 4 kg of dyestuff on the 3 kg precision scale.
 *
 * So these tests pin the two behaviours that matter:
 *
 *   1. UNSET really means unset. The threshold is `null` — not `0`, and
 *      not a hard-coded 3000 g that merely coincides with today's
 *      precision scale capacity. A value that is right by coincidence gets
 *      trusted as if it were right by decision.
 *   2. A MALFORMED threshold is REFUSED, not silently ignored. A typo
 *      must fail loudly at startup rather than quietly change which scale
 *      every component goes to.
 */
import { describe, it, expect } from 'vitest';
import {
  loadScaleConfig,
  DEFAULT_DISCONNECT_TIMEOUT_MS,
  DEFAULT_SAMPLE_INTERVAL_MS,
} from '../../src/004-scale-integration/infrastructure/config/scale-config.js';

describe('scale configuration', () => {
  it('uses the documented defaults when the environment is empty', () => {
    const config = loadScaleConfig({});

    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
    expect(config.databasePath).toBe('./data/weighingms.sqlite');
  });

  it('defaults the disconnect timeout to 2000 ms — IR-13', () => {
    // Detection within 2 s is a requirement, not a preference.
    expect(DEFAULT_DISCONNECT_TIMEOUT_MS).toBe(2000);
  });

  it('defaults the sample interval to 100 ms — IR-10', () => {
    // At least 10 readings a second.
    expect(DEFAULT_SAMPLE_INTERVAL_MS).toBe(100);
  });

  it('reads the disconnect timeout from the environment', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: '5000' });
    expect(config.disconnectTimeoutMs).toBe(5000);
  });

  it('reads the sample interval from the environment', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: '50' });
    expect(config.sampleIntervalMs).toBe(50);
  });

  it('reads the database path from the environment', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DATABASE_PATH: '/tmp/a.sqlite' });
    expect(config.databasePath).toBe('/tmp/a.sqlite');
  });

  it('treats an EMPTY timeout as absent, using the default', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: '' });
    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
  });

  it('treats a WHITESPACE-ONLY timeout as absent', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: '   ' });
    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
  });

  it('falls back to the default when the timeout is not a number', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: 'soon' });
    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
  });

  it('falls back to the default when the timeout is zero — a zero timeout would disconnect on every reading', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: '0' });
    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
  });

  it('falls back to the default when the timeout is negative', () => {
    const config = loadScaleConfig({ WEIGHINGMS_DISCONNECT_TIMEOUT_MS: '-1' });
    expect(config.disconnectTimeoutMs).toBe(DEFAULT_DISCONNECT_TIMEOUT_MS);
  });

  it('treats an EMPTY sample interval as absent', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: '' });
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });

  it('treats a WHITESPACE-ONLY sample interval as absent', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: '  ' });
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });

  it('falls back to the default when the sample interval is not a number', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: 'fast' });
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });

  it('falls back to the default when the sample interval is zero', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: '0' });
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });

  it('falls back to the default when the sample interval is negative', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SAMPLE_INTERVAL_MS: '-5' });
    expect(config.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });
});

describe('the selection threshold is unset while Q-04 is open — ADR-019', () => {
  it('is null when the environment does not set it', () => {
    const config = loadScaleConfig({});
    expect(config.selectionThreshold).toBeNull();
  });

  it('is null when the variable is present but EMPTY', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '' });
    expect(config.selectionThreshold).toBeNull();
  });

  it('is null when the variable is present but WHITESPACE-ONLY', () => {
    const config = loadScaleConfig({ WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '   ' });
    expect(config.selectionThreshold).toBeNull();
  });

  it('is NOT defaulted to 3000 g — a coincidence is not a decision', () => {
    // The precision scale's capacity is 3000 g. A hard-coded threshold of
    // the same number would look right today and be indistinguishable
    // from an invented answer to an open question.
    const config = loadScaleConfig({});

    expect(config.selectionThreshold).toBeNull();
    expect(config.selectionThreshold?.text).not.toBe('3000');
  });

  it('reads a configured threshold with its unit', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3000g',
    });

    expect(config.selectionThreshold).not.toBeNull();
    expect(config.selectionThreshold?.text).toBe('3000');
    expect(config.selectionThreshold?.unit).toBe('g');
  });

  it('accepts a threshold in kilograms', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3kg',
    });

    expect(config.selectionThreshold?.text).toBe('3');
    expect(config.selectionThreshold?.unit).toBe('kg');
  });

  it('lowercases the unit so "3KG" and "3kg" are the same configuration', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3KG',
    });

    expect(config.selectionThreshold?.unit).toBe('kg');
  });

  it('tolerates whitespace between the value and the unit', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3000 g',
    });

    expect(config.selectionThreshold?.text).toBe('3000');
    expect(config.selectionThreshold?.unit).toBe('g');
  });

  it('accepts a fractional threshold', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '2.5kg',
    });

    expect(config.selectionThreshold?.text).toBe('2.5');
  });

  it('accepts a negative threshold', () => {
    const config = loadScaleConfig({
      WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '-1g',
    });

    expect(config.selectionThreshold?.text).toBe('-1');
  });

  it('REFUSES a threshold with no unit — a bare number is a guess', () => {
    expect(() =>
      loadScaleConfig({ WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3000' }),
    ).toThrow(/must be "<number><unit>"/);
  });

  it('REFUSES a malformed threshold rather than silently ignoring it', () => {
    // A typo here would send every component to the wrong scale.
    expect(() =>
      loadScaleConfig({ WEIGHINGMS_SCALE_SELECTION_THRESHOLD: 'three kilos' }),
    ).toThrow(/must be "<number><unit>"/);
  });

  it('REFUSES a threshold in exponent notation — a float notation', () => {
    expect(() =>
      loadScaleConfig({ WEIGHINGMS_SCALE_SELECTION_THRESHOLD: '3e3g' }),
    ).toThrow(/must be "<number><unit>"/);
  });
});
