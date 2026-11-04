/**
 * OrgatexConfig — the OrgaTEX unit's configuration.
 *
 * Every value here is a **PARAMETER of a rule** rather than a constant
 * buried in an implementation, so the operational questions can be answered
 * without a rebuild (BRD NFR-14).
 */
import { BackoffSchedule } from '../../domain/value-objects/backoff-schedule.js';

/**
 * THE FRESHNESS WINDOW
 * --------------------
 * How long a last known-good snapshot may be served, marked with its age,
 * when the MES cannot be reached. It is configuration because "how long may
 * a queue be trusted" is an operational question, not a developer's.
 *
 * The default is 5 minutes. It is a **default, not an answer** — no
 * requirement states one, and the value is deliberately a round operational
 * figure rather than something derived from a requirement that does not
 * exist. It is what a station shift looks like between queue refreshes,
 * and it is settable without a rebuild.
 *
 * IT IS NOT INFINITE, BUT IT **IS** ZERO
 * --------------------------------------
 * A window of infinity would mean a snapshot from last week is presented
 * with a two-day age, and the age would be the only thing standing between
 * the operator and a schedule nobody is working. So infinity is refused.
 *
 * Zero, on the other hand, is **legal** — and R-06 names it explicitly: a
 * window of zero makes `DEGRADED` unreachable, because no snapshot is ever
 * fresh enough to serve, so the state transitions to `OFFLINE` on the
 * first failure.
 *
 * That is a documented behaviour, so the loader accepts a configured zero
 * rather than silently replacing it with the default — which is why the
 * window is read by `readNonNegativeInt` and not by `readInt`.
 */
export interface OrgatexConfig {
  /** The SQLite path — shared with the other units. */
  readonly databasePath: string;
  /**
   * How old a last known-good snapshot may be and still be served as
   * stale, in milliseconds.
   */
  readonly freshnessWindowMs: number;
  /** The name the adapter reports as the snapshot's source. */
  readonly sourceName: string;
  /**
   * What to do with a posting the MES rejected.
   *
   * ══════════════════════════════════════════════════════════════════
   * A DEFAULT IS NOT AN ANSWER TO CQ-06. (ADR-026)
   * ══════════════════════════════════════════════════════════════════
   *
   * CQ-06 asks whether a rejected posting may be re-driven. The default
   * here is `RETRYABLE`, and that default is deliberately **not** a
   * resolution of the question:
   *
   * - `RETRYABLE` — the posting may be re-driven later. The operational
   *   default, on the grounds that a rejection is usually a transient MES
   *   condition (a batch closed while we were weighing, a component
   *   entered in the wrong order). A rejection treated as permanent is a
   *   **consumption that is never sent** — a lost consumption on a real
   *   order. A rejection treated as retryable is a posting that stays
   *   visible and keeps failing loudly. The first is a **silently wrong
   *   number**; the second is a **visible problem**. Between the two, the
   *   loud one is the safer failure.
   * - `PERMANENT` — the posting is not re-driven. The rejected entry is
   *   **retained** either way (BRD IR-08), so a permanent rejection is a
   *   permanent, visible record rather than a gap.
   *
   * Under **both** dispositions the posting's state is `REJECTED`. The
   * disposition decides whether a *later* attempt may reuse the key —
   * and the key's reuse is bolt 007's queue to own. This bolt records
   * the rejection faithfully and exposes the disposition.
   */
  readonly rejectionDisposition: RejectionDisposition;
  /**
   * The bounded retry schedule for the sync queue.
   *
   * The **bound** (`maxMs`) is the part that matters: an unbounded backoff
   * is a queue that never retries, which is a silent discard with extra
   * steps. So the bound is a required parameter of the schedule, and it
   * is configuration rather than a constant in an implementation
   * (BRD NFR-14).
   */
  readonly syncBackoff: BackoffSchedule;
  /**
   * How often the retry worker looks for entries whose backoff has
   * expired, in milliseconds.
   */
  readonly syncRetryIntervalMs: number;
}

/**
 * What to do with a rejected posting.
 *
 * `RETRYABLE` — the posting may be re-driven later.
 * `PERMANENT` — the posting is not re-driven.
 */
export type RejectionDisposition = 'RETRYABLE' | 'PERMANENT';

export const REJECTION_DISPOSITIONS: readonly RejectionDisposition[] = [
  'RETRYABLE',
  'PERMANENT',
];

export const DEFAULT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export const DEFAULT_SYNC_BACKOFF_BASE_MS = 1000;
export const DEFAULT_SYNC_BACKOFF_MAX_MS = 300000;
export const DEFAULT_SYNC_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_SYNC_BACKOFF_JITTER_MS = 250;
export const DEFAULT_SYNC_RETRY_INTERVAL_MS = 5000;

export function loadOrgatexConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrgatexConfig {
  return {
    databasePath:
      env['WEIGHINGMS_DATABASE_PATH'] ?? './data/weighingms.sqlite',
    freshnessWindowMs: readNonNegativeInt(
      env['WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS'],
      DEFAULT_FRESHNESS_WINDOW_MS,
    ),
    sourceName: env['WEIGHINGMS_ORGATEX_SOURCE'] ?? 'DUMMY_ORGATEX',
    rejectionDisposition: readDisposition(
      env['WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION'],
    ),
    syncBackoff: BackoffSchedule.of(
      readInt(
        env['WEIGHINGMS_ORGATEX_SYNC_BACKOFF_BASE_MS'],
        DEFAULT_SYNC_BACKOFF_BASE_MS,
      ),
      readInt(
        env['WEIGHINGMS_ORGATEX_SYNC_BACKOFF_MAX_MS'],
        DEFAULT_SYNC_BACKOFF_MAX_MS,
      ),
      readInt(
        env['WEIGHINGMS_ORGATEX_SYNC_BACKOFF_MULTIPLIER'],
        DEFAULT_SYNC_BACKOFF_MULTIPLIER,
      ),
      readInt(
        env['WEIGHINGMS_ORGATEX_SYNC_BACKOFF_JITTER_MS'],
        DEFAULT_SYNC_BACKOFF_JITTER_MS,
      ),
    ),
    syncRetryIntervalMs: readInt(
      env['WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS'],
      DEFAULT_SYNC_RETRY_INTERVAL_MS,
    ),
  };
}

/**
 * Read the rejection disposition.
 *
 * An unrecognised value falls back to `RETRYABLE` rather than throwing,
 * on the same reasoning as the freshness window: refusing to start the
 * station because one environment variable is mistyped would be a worse
 * failure than the operational default.
 */
function readDisposition(raw: string | undefined): RejectionDisposition {
  if (raw === undefined || raw.trim() === '') {
    return 'RETRYABLE';
  }
  const value = raw.trim().toUpperCase();
  return (REJECTION_DISPOSITIONS as readonly string[]).includes(value)
    ? (value as RejectionDisposition)
    : 'RETRYABLE';
}

/**
 * Read a positive whole number from the environment.
 *
 * A malformed value falls back to the default rather than throwing: the
 * freshness window is an operational setting, and refusing to start the
 * station because one environment variable is mistyped would be a worse
 * failure than serving a snapshot with the default age.
 *
 * The freshness window is the one setting where that is the right trade,
 * and it is worth saying why: the alternative — refusing to start — turns
 * a typo into an unweighable station. The window's effect is to serve a
 * snapshot that is marked with its age, so a mistyped window produces a
 * visibly-aged snapshot, not a wrong number.
 *
 * `Number` rather than `parseInt`, deliberately. `parseInt('12.5.6')`
 * returns `12` — it parses the leading numeric prefix and ignores the
 * rest — so a mistyped value would be silently accepted as a number the
 * operator never wrote. `Number` rejects the whole string instead.
 */
function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Read a NON-NEGATIVE whole number from the environment.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AT ALL, WHEN `readInt` ALREADY READS A NUMBER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because **zero is a legal value** for the freshness window, and
 * `readInt` rejects it (`parsed <= 0`).
 *
 * R-06 is explicit: a window of zero makes `DEGRADED` unreachable, so the
 * state transitions to `OFFLINE` on the first failure. That behaviour is
 * only reachable if the loader accepts a zero — and `readInt` would
 * silently replace a configured zero with the default, so the documented
 * behaviour would be unreachable in practice.
 *
 * A second reader, rather than a flag on the first, because the two
 * settings want **opposite** rules and a boolean parameter would make
 * the call site a decision rather than a fact:
 *
 * - the freshness window — **zero is legal**;
 * - the retry interval and the backoff's parameters — **zero is not**,
 *   because a zero retry interval is a busy loop and a zero backoff base
 *   is a hot retry.
 */
function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}
