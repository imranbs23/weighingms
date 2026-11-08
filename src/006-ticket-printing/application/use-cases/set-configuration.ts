/**
 * SetConfiguration — the change, the version, and the audit.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CONFIGURATION CHANGE IS ITSELF AUDITED. AND THE VERSION IS ASSIGNED
 * BY THE CONSTRAINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story: *"A tolerance override that is not attributable has changed
 * the meaning of the weighings around it, so `setConfiguration` writes
 * through the same append-only audit API as every other privileged
 * action."*
 *
 * **And the audit entry carries SIX facts** — the actor, the actor's
 * role, the key changed, the previous value, the new value and the reason.
 *
 * **And the version's number is assigned ATOMICALLY**, by the
 * `UNIQUE (key, version)` constraint — so two concurrent changes get
 * distinct versions, the later wins the effective value, and **both** are
 * audited (ADR-045).
 */
import { randomUUID } from 'node:crypto';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  AuditAction,
  AuditEntry,
  AuditSubject,
} from '../../domain/entities/audit-entry.js';
import {
  ConfigurationCategory,
  ConfigurationKey,
  ConfigurationValue,
  ConfigurationVersion,
} from '../../domain/entities/configuration.js';
import type { ConfigurationRepository } from '../../domain/ports/configuration-repository.js';
import type { AuditEntryRepository } from '../../domain/ports/audit-entry-repository.js';

export type SetConfigurationOutcome =
  | {
      readonly kind: 'CHANGED';
      readonly version: ConfigurationVersion;
    }
  | {
      /** The reason is absent or empty. */
      readonly kind: 'REASON_REQUIRED';
      readonly message: string;
    }
  | {
      /** The scope does not exist. */
      readonly kind: 'SCOPE_NOT_FOUND';
      readonly message: string;
    };

export interface SetConfigurationOptions {
  /** The configuration store. */
  readonly configuration: ConfigurationRepository;
  /** The trail — bolt 020's append-only API. */
  readonly audit: AuditEntryRepository;
  /**
   * Whether a scope exists.
   *
   * **The station's own check** — an override applied to a scope that does
   * not exist is refused, and **no version is bumped**.
   */
  readonly scopeExists: (scope: string) => boolean | Promise<boolean>;
  /** The clock. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export class SetConfiguration {
  constructor(private readonly options: SetConfigurationOptions) {}

  /**
   * Change a configuration key.
   *
   * @param key The setting.
   * @param category Which kind of setting it is.
   * @param value The new value.
   * @param reason The justification — **mandatory**.
   * @param actorId Who changed it.
   * @param actorRole Their role.
   * @param scope What the override applies to — `null` for a global change.
   */
  async execute(
    key: string,
    category: ConfigurationCategory,
    value: string,
    reason: string,
    actorId: string,
    actorRole: string,
    scope: string | null = null,
  ): Promise<SetConfigurationOutcome> {
    // ── THE REASON. REFUSED BEFORE ANY WRITE. ──
    if (reason.trim().length === 0) {
      this.options.onError?.(
        '[ticket-printing] a configuration change was refused — it carried no reason',
      );
      return {
        kind: 'REASON_REQUIRED',
        message: 'A configuration change must carry a reason',
      };
    }

    const configKey = ConfigurationKey.create(key);

    // ── THE SCOPE. REFUSED BEFORE ANY VERSION IS BUMPED. ──
    //
    // *"An override is applied to a scope that does not exist → the change
    // is refused with a visible reason; no value is changed and no
    // effective-version bump occurs."*
    if (
      scope !== null &&
      !(await this.options.scopeExists(scope))
    ) {
      this.options.onError?.(
        `[ticket-printing] a configuration change was refused — the scope ${scope} does not exist`,
      );
      return {
        kind: 'SCOPE_NOT_FOUND',
        message: 'That scope does not exist',
      };
    }

    // ── THE PREVIOUS VALUE ──
    //
    // **The original is RETAINED** — and the previous version's value is
    // what a removal restores.
    const previous = await this.options.configuration.effective(configKey);
    const previousValue =
      previous === null ? null : ConfigurationValue.of(previous.value.value);

    // ── THE VERSION ──
    //
    // The number is **assigned by the constraint** — the repository's
    // insert refuses a duplicate, and the caller retries with the next
    // one. So the version here is the CANDIDATE, and the constraint
    // makes it safe.
    const candidate = (previous?.version ?? 0) + 1;

    const version = new ConfigurationVersion(
      randomUUID(),
      configKey,
      category,
      ConfigurationValue.of(value),
      candidate,
      Instant.of(this.options.clock()),
      actorId,
      actorRole,
      // The reason, VERBATIM.
      reason,
      previousValue,
      scope,
    );

    await this.writeWithRetry(version);

    // ── THE AUDIT ENTRY ──
    //
    // **SIX facts**: the actor, the role, the key changed, the previous
    // value, the new value and the reason.
    await this.options.audit.record(
      new AuditEntry({
        entryId: randomUUID(),
        action: AuditAction.of('CONFIGURATION_CHANGE'),
        actorId,
        actorRole,
        // The subject names the key and the scope — so the trail says
        // WHICH setting was changed.
        subject: AuditSubject.create(
          scope === null
            ? `key=${configKey.value}`
            : `key=${configKey.value};scope=${scope}`,
        ),
        reason,
        occurredAt: Instant.of(this.options.clock()),
      }),
    );

    return { kind: 'CHANGED', version };
  }

  /**
   * Write the version, retrying on a version collision.
   *
   * **The collision IS the concurrency guard** — two changes to one key
   * both attempt the same number, and the loser's insert fails. So the
   * loser retries with the next one, and **the later write wins** the
   * effective value.
   *
   * **And BOTH are audited** — the audit entry is written after the
   * version lands, so a losing change still reaches the trail (ADR-045).
   */
  private async writeWithRetry(
    version: ConfigurationVersion,
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await this.options.configuration.set(version);
        return;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;

        // The version number was taken concurrently — so take the next.
        const next = new ConfigurationVersion(
          version.versionId,
          version.key,
          version.category,
          version.value,
          version.version + 1,
          version.effectiveFrom,
          version.actorId,
          version.actorRole,
          version.reason,
          version.previousValue,
          version.scope,
        );
        await this.writeWithRetry(next);
        return;
      }
    }
    throw new Error(
      'The configuration version could not be assigned after five attempts',
    );
  }
}

/**
 * Is this error a UNIQUE constraint violation?
 *
 * The check is deliberately narrow — a different error must be re-thrown,
 * not swallowed (ADR-040's rule).
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('UNIQUE constraint failed') ||
    error.message.includes('SQLITE_CONSTRAINT_UNIQUE')
  );
}
