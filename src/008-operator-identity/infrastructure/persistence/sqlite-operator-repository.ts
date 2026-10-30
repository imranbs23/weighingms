/**
 * SQLiteOperatorRepository.
 *
 * Note the conversion of booleans to 0/1 integers. `node:sqlite` REJECTS
 * a boolean bind ("Provided value cannot be bound to SQLite parameter"),
 * so the conversion is explicit rather than implicit.
 */
import type { OperatorRepository } from '../../domain/ports/repositories.js';
import { Operator } from '../../domain/entities/operator.js';
import { OperatorId } from '../../domain/value-objects/operator-id.js';
import { OperatorRole } from '../../domain/value-objects/operator-role.js';
import type { SqliteDatabase } from './database.js';

interface OperatorRow {
  id: string;
  display_name: string;
  role: string;
  active: number;
  created_at: string;
}

export class SqliteOperatorRepository implements OperatorRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findById(id: OperatorId): Promise<Operator | null> {
    const row = this.db
      .prepare('SELECT * FROM operators WHERE id = ?')
      .get(id.value) as unknown as OperatorRow | undefined;
    return row ? this.toOperator(row) : null;
  }

  async save(operator: Operator): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO operators (id, display_name, role, active, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           role         = excluded.role,
           active       = excluded.active`,
      )
      .run(
        operator.id.value,
        operator.displayName,
        operator.role.value,
        operator.active ? 1 : 0,
        operator.createdAt.toISOString(),
      );
  }

  async findAll(): Promise<Operator[]> {
    const rows = this.db
      .prepare('SELECT * FROM operators ORDER BY id')
      .all() as unknown as OperatorRow[];
    return rows.map((row) => this.toOperator(row));
  }

  private toOperator(row: OperatorRow): Operator {
    return new Operator(
      OperatorId.create(row.id),
      row.display_name,
      OperatorRole.fromStored(row.role),
      row.active === 1,
      new Date(row.created_at),
    );
  }
}
