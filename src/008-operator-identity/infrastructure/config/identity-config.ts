/**
 * Identity configuration.
 *
 * The session lifetime is a CONFIGURATION VALUE, not a constant, because
 * CQ-02 — whether identity is established per shift or per weighing — is
 * unresolved. Hard-coding the duration would settle an open question by
 * accident, and FR-22 requires operational configuration to be changeable
 * without a redeployment.
 */
export interface IdentityConfig {
  /** Path to the SQLite database file. */
  readonly databasePath: string;

  /**
   * Session lifetime in milliseconds.
   *
   * Default: 8 hours — a working shift. This is a DEFAULT, not a decision:
   * CQ-02 remains open, and the value is settable per deployment.
   */
  readonly sessionLifetimeMs: number;

  /** Argon2id memory cost in KiB. */
  readonly argon2Memory: number;

  /** Argon2id number of passes. */
  readonly argon2Passes: number;
}

export const DEFAULT_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function loadIdentityConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityConfig {
  const databasePath =
    env['WEIGHINGMS_DB_PATH'] ??
    env['DATABASE_PATH'] ??
    './data/weighingms.sqlite';

  const sessionLifetimeMs = readInt(
    env['WEIGHINGMS_SESSION_LIFETIME_MS'],
    DEFAULT_SESSION_LIFETIME_MS,
  );

  return {
    databasePath,
    sessionLifetimeMs,
    argon2Memory: readInt(env['WEIGHINGMS_ARGON2_MEMORY'], 19456),
    argon2Passes: readInt(env['WEIGHINGMS_ARGON2_PASSES'], 2),
  };
}

function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid numeric configuration value: ${raw}`);
  }
  return Math.floor(n);
}
