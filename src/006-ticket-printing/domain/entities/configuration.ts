/**
 * ConfigurationEntry — a key's EFFECTIVE value, and the versions behind it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE HISTORY IS THE TRUTH. THE EFFECTIVE VALUE IS A PROJECTION OF IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A configuration value is not a setting — it is a statement about what a
 * weighing **MEANT**. So a mutable key-value row would erase the history
 * of every statement the station has ever made, and a shade failure six
 * weeks old would be unsettleable.
 *
 * So every change is a **new version**, and the effective value is a
 * **projection** — rebuildable from the history, and prevented from
 * drifting from it by a trigger (ADR-045).
 *
 * AND THE EFFECTIVE VALUE IS A FUNCTION OF TIME
 * ----------------------------------------------
 * *"A weighing is always evaluated against the configuration in force when
 * it was taken."* So the version carries an `effectiveFrom`, and the
 * historical lookup answers "what was in force then?".
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';

/**
 * The configuration categories.
 *
 * **The four NAMED ones** — the story names them: scale thresholds,
 * tolerance overrides, the label template and the operator language.
 *
 * **And the key set is NOT closed** — a new key carries a category and a
 * type, and is **not hard-coded into call sites**. So the category is a
 * closed set (a category without a type cannot be read back) while the
 * *keys* are open.
 */
export const CONFIGURATION_CATEGORY_SCALE_THRESHOLD = 'SCALE_THRESHOLD';
export const CONFIGURATION_CATEGORY_TOLERANCE = 'TOLERANCE';
export const CONFIGURATION_CATEGORY_TEMPLATE = 'TEMPLATE';
export const CONFIGURATION_CATEGORY_LANGUAGE = 'LANGUAGE';

export const CONFIGURATION_CATEGORIES = [
  CONFIGURATION_CATEGORY_SCALE_THRESHOLD,
  CONFIGURATION_CATEGORY_TOLERANCE,
  CONFIGURATION_CATEGORY_TEMPLATE,
  CONFIGURATION_CATEGORY_LANGUAGE,
] as const;

export type ConfigurationCategoryValue =
  (typeof CONFIGURATION_CATEGORIES)[number];

export class ConfigurationCategory {
  private constructor(readonly value: ConfigurationCategoryValue) {}

  static of(value: ConfigurationCategoryValue): ConfigurationCategory {
    return new ConfigurationCategory(value);
  }

  static fromStored(raw: string): ConfigurationCategory {
    if ((CONFIGURATION_CATEGORIES as readonly string[]).includes(raw)) {
      return new ConfigurationCategory(raw as ConfigurationCategoryValue);
    }
    throw new Error(`Unknown configuration category: ${raw}`);
  }

  toString(): string {
    return this.value;
  }
}

/**
 * A configuration key.
 *
 * **A bounded string, not an enum** — the key set is not closed by any
 * requirement, and a new key must be added with a category and a type
 * rather than by changing a union.
 */
export class ConfigurationKey {
  private constructor(readonly value: string) {}

  static create(raw: string): ConfigurationKey {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('A configuration key must not be empty');
    }
    if (value.length > 128) {
      throw new Error('A configuration key must not exceed 128 characters');
    }
    return new ConfigurationKey(value);
  }

  equals(other: ConfigurationKey): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * A configuration value.
 *
 * **Always a string** — a scale threshold and a template id are both
 * strings, and a typed union of every possible value would be a second
 * taxonomy to keep in step.
 */
export class ConfigurationValue {
  private constructor(readonly value: string) {}

  static of(raw: string): ConfigurationValue {
    if (raw.length > 1024) {
      throw new Error('A configuration value must not exceed 1024 characters');
    }
    return new ConfigurationValue(raw);
  }

  equals(other: ConfigurationValue): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * ONE version of one key — the history's row.
 *
 * **Immutable once written**, and **append-only** in the database.
 */
export class ConfigurationVersion {
  constructor(
    /** The version's identity — a uuid. */
    readonly versionId: string,
    /** Which setting. */
    readonly key: ConfigurationKey,
    /** Which kind of setting. */
    readonly category: ConfigurationCategory,
    /** The value this version carries. */
    readonly value: ConfigurationValue,
    /** The key's version number — **monotonic per key**. */
    readonly version: number,
    /** When it came into force. */
    readonly effectiveFrom: Instant,
    /** Who set it. */
    readonly actorId: string,
    /** Their role. */
    readonly actorRole: string,
    /**
     * The reason — **never empty**.
     *
     * An unattributable override changed the meaning of the weighings
     * around it, so a change without a justification is refused.
     */
    readonly reason: string,
    /** What it replaced — **the original value is retained**. */
    readonly previousValue: ConfigurationValue | null,
    /** What the override applies to — a key, a component, or a range. */
    readonly scope: string | null,
  ) {
    if (reason.trim().length === 0) {
      throw new Error('A configuration change must carry a reason');
    }
  }
}

/**
 * A key's EFFECTIVE value — the projection.
 */
export class ConfigurationEntry {
  constructor(
    readonly key: ConfigurationKey,
    readonly value: ConfigurationValue,
    readonly category: ConfigurationCategory,
    /** The version in force. */
    readonly version: number,
    /** When it came into force. */
    readonly effectiveFrom: Instant,
    /** Who set it. */
    readonly actorId: string,
    /** When the projection row was written. */
    readonly updatedAt: Instant,
  ) {}
}
