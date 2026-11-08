/**
 * SqliteConfigurationRepository — the history and its projection.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE VERSION AND ITS PROJECTION ARE WRITTEN IN ONE TRANSACTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's power-loss edge case: *"Either the previous version or the
 * new version is in effect, **never a partially written value**; the audit
 * entry and the version record agree."*
 *
 * So the version insert and the projection upsert are **one transaction** —
 * and the `UNIQUE (config_key, version)` is the guard that makes the
 * version's number safe under concurrency (ADR-045).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  ConfigurationCategory,
  ConfigurationEntry,
  ConfigurationKey,
  ConfigurationValue,
  ConfigurationVersion,
} from '../../domain/entities/configuration.js';
import type { ConfigurationRepository } from '../../domain/ports/configuration-repository.js';
import type { SqliteDatabase } from './configuration-database.js';

interface VersionRow {
  version_id: string;
  config_key: string;
  category: string;
  value: string;
  version: number;
  effective_from: string;
  actor_id: string;
  actor_role: string;
  reason: string;
  previous_value: string | null;
  scope: string | null;
  recorded_at: string;
}

interface EffectiveRow {
  config_key: string;
  value: string;
  category: string;
  version: number;
  effective_from: string;
  actor_id: string;
  updated_at: string;
}

export class SqliteConfigurationRepository implements ConfigurationRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * The value in force — now, or at a given moment.
   *
   * **A function of TIME**: the newest version whose `effective_from` is
   * at or before the moment asked about. So a weighing is evaluable
   * against the configuration in force when it was taken.
   */
  async effective(
    key: ConfigurationKey,
    at?: Date,
  ): Promise<ConfigurationEntry | null> {
    const when = (at ?? this.clock()).toISOString();

    const row = this.db
      .prepare(
        `SELECT * FROM configuration_versions
          WHERE config_key = ? AND effective_from <= ?
          ORDER BY effective_from DESC, version DESC
          LIMIT 1`,
      )
      .get(key.value, when) as unknown as VersionRow | undefined;

    if (row === undefined) return null;

    return new ConfigurationEntry(
      ConfigurationKey.create(row.config_key),
      ConfigurationValue.of(row.value),
      ConfigurationCategory.fromStored(row.category),
      row.version,
      Instant.of(new Date(row.effective_from)),
      row.actor_id,
      Instant.of(new Date(row.recorded_at)),
    );
  }

  /**
   * Write a version, and update the effective projection.
   *
   * **ONE transaction** — so a power loss leaves either the previous
   * version or the new one in effect.
   */
  async set(version: ConfigurationVersion): Promise<void> {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO configuration_versions
             (version_id, config_key, category, value, version,
              effective_from, actor_id, actor_role, reason, previous_value,
              scope, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          version.versionId,
          version.key.value,
          version.category.value,
          version.value.value,
          version.version,
          version.effectiveFrom.toDate().toISOString(),
          version.actorId,
          version.actorRole,
          version.reason,
          version.previousValue?.value ?? null,
          version.scope,
          this.clock().toISOString(),
        );

      // THE PROJECTION. And the trigger refuses to point it at a version
      // that does not exist — so it cannot drift from the truth.
      this.db
        .prepare(
          `INSERT INTO configuration_effective
             (config_key, value, category, version, effective_from,
              actor_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(config_key) DO UPDATE SET
             value = excluded.value,
             category = excluded.category,
             version = excluded.version,
             effective_from = excluded.effective_from,
             actor_id = excluded.actor_id,
             updated_at = excluded.updated_at`,
        )
        .run(
          version.key.value,
          version.value.value,
          version.category.value,
          version.version,
          version.effectiveFrom.toDate().toISOString(),
          version.actorId,
          this.clock().toISOString(),
        );

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The key's history, oldest first. */
  async history(
    key: ConfigurationKey,
  ): Promise<readonly ConfigurationVersion[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM configuration_versions
          WHERE config_key = ?
          ORDER BY effective_from ASC, version ASC`,
      )
      .all(key.value) as unknown as VersionRow[];

    return rows.map((row) => toVersion(row));
  }

  /** Every effective entry. */
  async all(): Promise<readonly ConfigurationEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM configuration_effective ORDER BY config_key ASC`,
      )
      .all() as unknown as EffectiveRow[];

    return rows.map(
      (row): ConfigurationEntry =>
        new ConfigurationEntry(
          ConfigurationKey.create(row.config_key),
          ConfigurationValue.of(row.value),
          ConfigurationCategory.fromStored(row.category),
          row.version,
          Instant.of(new Date(row.effective_from)),
          row.actor_id,
          Instant.of(new Date(row.updated_at)),
        ),
    );
  }
}

/**
 * Rebuild a version from its row.
 */
function toVersion(row: VersionRow): ConfigurationVersion {
  return new ConfigurationVersion(
    row.version_id,
    ConfigurationKey.create(row.config_key),
    ConfigurationCategory.fromStored(row.category),
    ConfigurationValue.of(row.value),
    row.version,
    Instant.of(new Date(row.effective_from)),
    row.actor_id,
    row.actor_role,
    row.reason,
    row.previous_value === null
      ? null
      : ConfigurationValue.of(row.previous_value),
    row.scope,
  );
}
