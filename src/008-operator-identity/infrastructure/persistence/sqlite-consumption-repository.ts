/**
 * SqliteConsumptionRepository.
 *
 * Consumption is a SEPARATE append-only record (ADR-006). The
 * authorisation is never updated, and this table is where the fact "this
 * authorisation was used" lives.
 *
 * The UNIQUE constraint on `authorisation_id` — declared in the migration —
 * IS the single-use rule. It makes a double-spend impossible even when
 * two consume requests arrive concurrently, which the service's
 * check-then-insert sequence cannot guarantee on its own.
 *
 * There is no `update` and no `delete` here either: a fact about what
 * happened is not revised.
 */
import type {
  ConsumptionRepository,
} from '../../domain/ports/authorisation-repository.js';
import { AuthorisationConsumption } from '../../domain/entities/authorisation-consumption.js';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { PrivilegedAction } from '../../domain/value-objects/privileged-action.js';
import { AuthorisationSubject } from '../../domain/value-objects/authorisation-subject.js';
import type { SqliteDatabase } from './database.js';

interface ConsumptionRow {
  id: string;
  authorisation_id: string;
  action: string;
  subject: string;
  consumed_at: string;
  operator_id: string;
}

export class SqliteConsumptionRepository implements ConsumptionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * INSERT ONLY.
   *
   * A second consumption of the same authorisation fails with a UNIQUE
   * constraint violation. The service catches that and reports it as the
   * `ALREADY_USED` refusal it is — and the constraint, not the service's
   * check, is what makes it correct under concurrency.
   */
  async save(consumption: AuthorisationConsumption): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO authorisation_consumptions
           (id, authorisation_id, action, subject, consumed_at, operator_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        consumption.id,
        consumption.authorisationId,
        consumption.action.value,
        consumption.subject.value,
        consumption.consumedAt.toISOString(),
        consumption.operatorId.value,
      );
  }

  async findByAuthorisationId(
    authorisationId: string,
  ): Promise<AuthorisationConsumption | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM authorisation_consumptions WHERE authorisation_id = ?',
      )
      .get(authorisationId) as unknown as ConsumptionRow | undefined;
    return row ? this.toConsumption(row) : null;
  }

  async existsFor(authorisationId: string): Promise<boolean> {
    const row = this.db
      .prepare(
        'SELECT 1 AS found FROM authorisation_consumptions WHERE authorisation_id = ? LIMIT 1',
      )
      .get(authorisationId) as unknown as { found: number } | undefined;
    return row !== undefined;
  }

  private toConsumption(row: ConsumptionRow): AuthorisationConsumption {
    return new AuthorisationConsumption(
      row.id,
      row.authorisation_id,
      PrivilegedAction.fromStored(row.action),
      AuthorisationSubject.fromStored(row.subject),
      new Date(row.consumed_at),
      OperatorId.create(row.operator_id),
    );
  }
}
