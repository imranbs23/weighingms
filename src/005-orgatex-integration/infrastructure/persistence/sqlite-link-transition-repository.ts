/**
 * SqliteLinkTransitionRepository — the append-only transition log.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE INTERFACE HAS NO UPDATE AND NO DELETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * So this class has none either. The absence is the guarantee — a future
 * caller cannot rewrite history even by accident.
 *
 * And the table carries TRIGGERS that abort any UPDATE or DELETE, so
 * the guarantee holds even for code that reaches past the repository —
 * a `DELETE FROM link_transitions` in a repair script, for instance.
 *
 * A transition is a fact about the past, and the transition record exists
 * to serve a diagnosis. A rewritten history cannot.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  linkTransition,
  type LinkTransition,
  type LinkTransitionCause,
} from '../../domain/entities/link-transition.js';
import type { LinkTransitionRepository } from '../../domain/ports/link-repositories.js';
import type { LinkStatus } from '../../domain/value-objects/link-status.js';
import type { SqliteDatabase } from './orgatex-database.js';

interface TransitionRow {
  id: number;
  from_status: LinkStatus;
  to_status: LinkStatus;
  occurred_at: string;
  cause: LinkTransitionCause;
}

export class SqliteLinkTransitionRepository implements LinkTransitionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async append(transition: LinkTransition): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO link_transitions (
           from_status, to_status, occurred_at, cause
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        transition.from,
        transition.to,
        transition.occurredAt.toDate().toISOString(),
        transition.cause,
      );
  }

  async findAll(): Promise<LinkTransition[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM link_transitions
          ORDER BY occurred_at ASC, id ASC`,
      )
      .all() as unknown as TransitionRow[];
    return rows.map(toTransition);
  }

  async findMostRecent(): Promise<LinkTransition | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM link_transitions
          ORDER BY occurred_at DESC, id DESC
          LIMIT 1`,
      )
      .get() as unknown as TransitionRow | undefined;
    return row === undefined ? null : toTransition(row);
  }
}

function toTransition(row: TransitionRow): LinkTransition {
  return linkTransition({
    from: row.from_status,
    to: row.to_status,
    occurredAt: Instant.of(new Date(row.occurred_at)),
    cause: row.cause,
  });
}
