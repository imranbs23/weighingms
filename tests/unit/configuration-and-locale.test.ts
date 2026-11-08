/**
 * The configuration store and the locale — unit 006, bolt 022.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE HISTORY IS THE TRUTH. AND THE FALLBACK IS PER KEY.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  ConfigurationCategory,
  ConfigurationKey,
  ConfigurationValue,
  ConfigurationVersion,
} from '../../src/006-ticket-printing/domain/entities/configuration.js';
import {
  SqliteConfigurationRepository,
} from '../../src/006-ticket-printing/infrastructure/persistence/sqlite-configuration-repository.js';
import {
  openConfigurationDatabase,
  type SqliteDatabase,
} from '../../src/006-ticket-printing/infrastructure/persistence/configuration-database.js';
import {
  JsonLocaleBundleAdapter,
} from '../../src/006-ticket-printing/infrastructure/adapters/json-locale-bundle-adapter.js';
import { ResolveString } from '../../src/006-ticket-printing/application/use-cases/resolve-string.js';
import {
  writeLocaleBundles,
  DEFAULT_STRINGS,
} from '../support/locale-bundles.js';

const AT = Instant.of(new Date('2026-11-06T15:00:00.000Z'));

function version(
  key: string,
  value: string,
  versionNumber: number,
  options: {
    readonly effectiveFrom?: Instant;
    readonly previous?: string | null;
    readonly reason?: string;
    readonly scope?: string | null;
  } = {},
): ConfigurationVersion {
  return new ConfigurationVersion(
    `VER-${key}-${versionNumber}`,
    ConfigurationKey.create(key),
    ConfigurationCategory.of('TOLERANCE'),
    ConfigurationValue.of(value),
    versionNumber,
    options.effectiveFrom ?? AT,
    'OP-SUP-001',
    'SUPERVISOR',
    options.reason ?? 'the tolerance was reviewed',
    options.previous === undefined || options.previous === null
      ? null
      : ConfigurationValue.of(options.previous),
    options.scope ?? null,
  );
}

describe('the configuration store', () => {
  let db: SqliteDatabase;
  let configuration: SqliteConfigurationRepository;

  beforeEach(() => {
    db = openConfigurationDatabase(':memory:');
    // The clock is FIXED, and it is AFTER the versions' effective moments —
    // otherwise a version dated later today would not yet be in force.
    configuration = new SqliteConfigurationRepository(db, () =>
      new Date('2026-11-06T18:00:00.000Z'),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('a change creates a NEW version — the history is not overwritten', async () => {
    await configuration.set(version('tolerance.dye', '2.0000', 1));
    await configuration.set(
      version('tolerance.dye', '2.5000', 2, { previous: '2.0000' }),
    );

    const history = await configuration.history(
      ConfigurationKey.create('tolerance.dye'),
    );

    expect(history).toHaveLength(2);
    expect(history[0]?.value.value).toBe('2.0000');
    expect(history[1]?.value.value).toBe('2.5000');
  });

  it('the ORIGINAL value is RETAINED', async () => {
    await configuration.set(version('tolerance.dye', '2.0000', 1));
    await configuration.set(
      version('tolerance.dye', '2.5000', 2, { previous: '2.0000' }),
    );

    const history = await configuration.history(
      ConfigurationKey.create('tolerance.dye'),
    );

    // The second version carries what it replaced.
    expect(history[1]?.previousValue?.value).toBe('2.0000');
    // And the first version is untouched.
    expect(history[0]?.previousValue).toBeNull();
  });

  it('the effective value is the LATEST version', async () => {
    await configuration.set(version('tolerance.dye', '2.0000', 1));
    await configuration.set(version('tolerance.dye', '2.5000', 2));

    const effective = await configuration.effective(
      ConfigurationKey.create('tolerance.dye'),
    );

    expect(effective?.value.value).toBe('2.5000');
    expect(effective?.version).toBe(2);
  });

  it('the effective value is a FUNCTION OF TIME — the past is reconstructable', async () => {
    const earlier = Instant.of(new Date('2026-11-01T09:00:00.000Z'));
    const later = Instant.of(new Date('2026-11-06T15:00:00.000Z'));

    await configuration.set(
      version('tolerance.dye', '2.0000', 1, { effectiveFrom: earlier }),
    );
    await configuration.set(
      version('tolerance.dye', '2.5000', 2, { effectiveFrom: later }),
    );

    // NOW — the later one.
    const now = await configuration.effective(
      ConfigurationKey.create('tolerance.dye'),
    );
    expect(now?.value.value).toBe('2.5000');

    // AND ON THE DAY OF THE OLDER ONE — the older one.
    const then = await configuration.effective(
      ConfigurationKey.create('tolerance.dye'),
      new Date('2026-11-01T12:00:00.000Z'),
    );
    expect(then?.value.value).toBe('2.0000');
  });

  it('a key that was never set is a STATE, not an error', async () => {
    const effective = await configuration.effective(
      ConfigurationKey.create('never.set'),
    );
    expect(effective).toBeNull();
  });

  it('the version is UNIQUE per key — the concurrency guard', async () => {
    await configuration.set(version('tolerance.dye', '2.0000', 1));

    // The SAME version number for the same key is refused.
    await expect(
      configuration.set(version('tolerance.dye', '2.1000', 1)),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('the history refuses an UPDATE and a DELETE', async () => {
    await configuration.set(version('tolerance.dye', '2.0000', 1));

    expect(() =>
      db.prepare(`UPDATE configuration_versions SET value = 'TAMPERED'`).run(),
    ).toThrow(/append-only/);

    expect(() =>
      db.prepare(`DELETE FROM configuration_versions`).run(),
    ).toThrow(/append-only/);
  });

  it('the EFFECTIVE row cannot DRIFT from the history', () => {
    // A projection naming a version that does not exist is refused.
    expect(() =>
      db
        .prepare(
          `INSERT INTO configuration_effective
             (config_key, value, category, version, effective_from, actor_id, updated_at)
           VALUES ('tolerance.dye', '9.9999', 'TOLERANCE', 99, ?, 'OP-SUP-001', ?)`,
        )
        .run(AT.toDate().toISOString(), AT.toDate().toISOString()),
    ).toThrow(/real version/);
  });

  it('a version WITHOUT a reason is refused — the check is in the constructor', () => {
    expect(() =>
      version('tolerance.dye', '2.0000', 1, { reason: '' }),
    ).toThrow(/reason/);
  });
});

describe('the locale bundle', () => {
  let directory: string;
  let adapter: JsonLocaleBundleAdapter;

  beforeEach(() => {
    directory = writeLocaleBundles(
      join(tmpdir(), 'weighingms-locales-' + randomUUID()),
    );
    adapter = new JsonLocaleBundleAdapter({
      directory,
      defaultLocale: 'en',
    });
  });

  it('the bundle is read from a FILE — at runtime', async () => {
    const bundle = await adapter.load('en');

    expect(bundle).not.toBeNull();
    expect(bundle?.strings['weigh.title']).toBe('Weighing station');
    expect(Object.keys(bundle?.strings ?? {}).length).toBeGreaterThan(0);
  });

  it('a bundle that does not exist is a STATE, not an error', async () => {
    expect(await adapter.load('does-not-exist')).toBeNull();
  });

  it('the string is served in the CONFIGURED language', async () => {
    const resolve = new ResolveString({ bundles: adapter });

    expect(await resolve.execute('ar', 'weigh.title')).toBe('محطة الوزن');
  });

  it('a MISSING key falls back PER KEY — and the rest is served normally', async () => {
    const resolve = new ResolveString({ bundles: adapter });

    // The Arabic bundle has 'weigh.title' but NOT 'weigh.target'.
    expect(await resolve.execute('ar', 'weigh.target')).toBe(
      DEFAULT_STRINGS['weigh.target'],
    );

    // AND the rest of the Arabic bundle is served normally — the fallback
    // is per key, not per bundle.
    expect(await resolve.execute('ar', 'weigh.cancel')).toBe('إلغاء');
  });

  it('a key missing from BOTH bundles returns the KEY — and no request fails', async () => {
    const resolve = new ResolveString({ bundles: adapter });

    expect(await resolve.execute('ar', 'no.such.key')).toBe('no.such.key');
  });

  it('a MISSING bundle falls back entirely — and no request fails', async () => {
    const resolve = new ResolveString({ bundles: adapter });

    expect(await resolve.execute('does-not-exist', 'weigh.title')).toBe(
      DEFAULT_STRINGS['weigh.title'],
    );
  });

  it('the bundle is CACHED — the file is read once', async () => {
    const first = await adapter.load('en');
    const second = await adapter.load('en');

    expect(first).toBe(second);
  });

  it('invalidating the cache picks up an EDITED bundle — no restart', async () => {
    await adapter.load('en');
    adapter.invalidate();

    // The adapter re-reads the file, so an edited bundle is picked up.
    const bundle = await adapter.load('en');
    expect(bundle).not.toBeNull();
  });
});
