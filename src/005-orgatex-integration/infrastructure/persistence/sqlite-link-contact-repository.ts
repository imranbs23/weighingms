/**
 * SqliteLinkContactRepository — the link's observations.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE ROW. THE OBSERVATIONS, NEVER THE DERIVED STATUS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * There is no `setStatus` method, and that absence is the point.
 *
 * The link's status is **derived** from these columns by a pure policy
 * on every read. A persisted status would be a second source of truth:
 * it would have to be updated on every path that can change the link —
 * the posting path, the read path, the queue's delivery, the scheduled
 * deadline — and every path that forgets is a path that reports the
 * wrong state to the operator.
 *
 * The table's `CHECK (id = 1)` makes a second row structurally
 * impossible: there is exactly one link, and the schema says so.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { LinkContactRepository } from '../../domain/ports/link-repositories.js';
import {
  EMPTY_OBSERVATIONS,
  type LinkObservations,
} from '../../domain/value-objects/link-state.js';
import {
  SyncError,
  type SyncErrorCode,
} from '../../domain/value-objects/sync-error.js';

interface ObservationRow {
  id: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  last_error_detail: string | null;
  consecutive_failures: number;
}

export class SqliteLinkContactRepository implements LinkContactRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async read(): Promise<LinkObservations> {
    const row = this.db
      .prepare('SELECT * FROM link_contact_observations WHERE id = 1')
      .get() as unknown as ObservationRow | undefined;

    if (row === undefined) {
      // The migration seeds the row, so this cannot happen — and if it
      // somehow did, an absent row means "never contacted", not "broken".
      return { ...EMPTY_OBSERVATIONS };
    }

    return {
      lastSuccessAt:
        row.last_success_at === null
          ? null
          : Instant.of(new Date(row.last_success_at)),
      lastFailureAt:
        row.last_failure_at === null
          ? null
          : Instant.of(new Date(row.last_failure_at)),
      lastError:
        row.last_error_code === null
          ? null
          : SyncError.of(
              row.last_error_code as SyncErrorCode,
              row.last_error_summary ?? '',
              row.last_error_detail ?? '',
            ),
      consecutiveFailures: row.consecutive_failures,
    };
  }

  async recordSuccess(at: Instant): Promise<void> {
    // The streak resets to zero and the last error clears — a success
    // means the link is healthy, and there is no error to report about a
    // healthy link.
    this.db
      .prepare(
        `UPDATE link_contact_observations
            SET last_success_at = ?,
                consecutive_failures = 0,
                last_error_code = NULL,
                last_error_summary = NULL,
                last_error_detail = NULL
          WHERE id = 1`,
      )
      .run(at.toDate().toISOString());
  }

  async recordFailure(error: SyncError, at: Instant): Promise<void> {
    this.db
      .prepare(
        `UPDATE link_contact_observations
            SET last_failure_at = ?,
                consecutive_failures = consecutive_failures + 1,
                last_error_code = ?,
                last_error_summary = ?,
                last_error_detail = ?
          WHERE id = 1`,
      )
      .run(
        at.toDate().toISOString(),
        error.code,
        error.summary,
        error.detail,
      );
  }
}

// Imported late so the class body above reads cleanly.
import type { SqliteDatabase } from './orgatex-database.js';
