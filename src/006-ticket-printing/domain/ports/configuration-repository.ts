/**
 * The configuration's port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE HISTORY IS APPEND-ONLY. AND THE EFFECTIVE VALUE IS A PROJECTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The interface has `effective`, `set`, `history` and `all` — and **no
 * mutator for the history**. A version is written once and never revised
 * (BRD DR-02).
 *
 * **And `effective(key, at?)` is a function of TIME** — the newest version
 * whose `effectiveFrom` is at or before the moment asked about. That is
 * what makes a weighing evaluable against the configuration in force when
 * it was taken (ADR-045).
 */
import type {
  ConfigurationEntry,
  ConfigurationKey,
  ConfigurationVersion,
} from '../entities/configuration.js';

export interface ConfigurationRepository {
  /**
   * The value in force — now, or at a given moment.
   *
   * `null` when the key has never been set. A key that has never been set
   * is a **state**, not an error.
   */
  effective(
    key: ConfigurationKey,
    at?: Date,
  ): Promise<ConfigurationEntry | null>;

  /**
   * Write a version, and update the effective projection.
   *
   * **ONE transaction** — so the version and its audit entry always agree,
   * and so a power loss leaves either the previous version or the new one
   * in effect, never a partial value.
   *
   * And the version number is assigned **atomically**, by the
   * `UNIQUE (key, version)` constraint — so two concurrent changes get
   * distinct versions and the later write wins.
   */
  set(version: ConfigurationVersion): Promise<void>;

  /** The key's history, oldest first. */
  history(key: ConfigurationKey): Promise<readonly ConfigurationVersion[]>;

  /** Every effective entry. */
  all(): Promise<readonly ConfigurationEntry[]>;
}
