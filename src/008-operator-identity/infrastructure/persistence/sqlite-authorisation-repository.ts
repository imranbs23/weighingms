/**
 * SqliteAuthorisationRepository.
 *
 * NOTE THE MISSING `update` AND `delete` — there are none, by design.
 * The authorisation is APPEND-ONLY (A-7, BRD DR-01/DR-02). The interface
 * has no such method, so there is nothing to call that would mutate one.
 *
 * `save` is INSERT ONLY: saving an existing id fails with a UNIQUE
 * constraint violation rather than overwriting the row. That is the
 * storage layer's expression of the same append-only rule.
 *
 * The `reason` column is stored in CLEAR TEXT (ADR-005). It is a record,
 * not a credential — it authorises nothing, and it must be readable by an
 * auditor years later.
 */
import type {
  AuthorisationRepository,
} from '../../domain/ports/authorisation-repository.js';
import { SupervisorAuthorisation } from '../../domain/entities/supervisor-authorisation.js';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { SessionId } from '../../domain/value-objects/session-id.js';
import { PrivilegedAction } from '../../domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../domain/value-objects/authorisation-subject.js';
import { AuthorisationReason } from '../../domain/value-objects/authorisation-reason.js';
import { AuthorisationWindow } from '../../domain/value-objects/authorisation-window.js';
import type { SqliteDatabase } from './database.js';

interface AuthorisationRow {
  id: string;
  session_id: string;
  supervisor_id: string;
  requested_operator_id: string | null;
  action: string;
  subject: string;
  reason: string;
  authorised_at: string;
  expires_at: string;
}

export class SqliteAuthorisationRepository implements AuthorisationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * INSERT ONLY.
   *
   * There is deliberately no update path. A second insert of the same id
   * fails with a UNIQUE constraint violation — which is the append-only
   * rule enforced by the storage layer rather than by convention.
   */
  async save(authorisation: SupervisorAuthorisation): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO supervisor_authorisations
           (id, session_id, supervisor_id, requested_operator_id, action, subject, reason, authorised_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        authorisation.id,
        authorisation.sessionId.value,
        authorisation.supervisorId.value,
        authorisation.requestedOperatorId?.value ?? null,
        authorisation.action.value,
        authorisation.subject.value,
        authorisation.reason.value,
        authorisation.authorisedAt.toISOString(),
        authorisation.expiresAt.toISOString(),
      );
  }

  async findById(id: string): Promise<SupervisorAuthorisation | null> {
    const row = this.db
      .prepare('SELECT * FROM supervisor_authorisations WHERE id = ?')
      .get(id) as unknown as AuthorisationRow | undefined;
    return row ? this.toAuthorisation(row) : null;
  }

  async findBySubject(subject: AuthorisationSubject): Promise<SupervisorAuthorisation[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM supervisor_authorisations
          WHERE subject = ?
          ORDER BY authorised_at DESC`,
      )
      .all(subject.value) as unknown as AuthorisationRow[];
    return rows.map((row) => this.toAuthorisation(row));
  }

  async findExpired(now: Date): Promise<SupervisorAuthorisation[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM supervisor_authorisations
          WHERE expires_at <= ?
          ORDER BY expires_at`,
      )
      .all(now.toISOString()) as unknown as AuthorisationRow[];
    return rows.map((row) => this.toAuthorisation(row));
  }

  private toAuthorisation(row: AuthorisationRow): SupervisorAuthorisation {
    return new SupervisorAuthorisation(
      row.id,
      SessionId.fromStored(row.session_id),
      OperatorId.create(row.supervisor_id),
      // NULL means "raised with no signed-in operator" — it round-trips as
      // null, not as an empty string that would fail to parse.
      row.requested_operator_id === null
        ? null
        : OperatorId.create(row.requested_operator_id),
      PrivilegedAction.fromStored(row.action),
      AuthorisationSubject.fromStored(row.subject),
      // The reason round-trips EXACTLY. It is stored in clear text, so
      // there is nothing to decode — and the meaningfulness check is
      // re-applied on read, so a corrupted row cannot become a record
      // that appears to carry a justification it does not.
      AuthorisationReason.fromStored(row.reason),
      AuthorisationWindow.of(
        new Date(row.authorised_at),
        new Date(row.expires_at),
      ),
    );
  }
}
