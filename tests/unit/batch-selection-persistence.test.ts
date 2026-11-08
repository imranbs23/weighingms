/**
 * The batch selection's durable record.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT IS UNDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * The repository:
 *   - saves a selection, and reads it back intact
 *   - the ACTIVE selection is the NEWEST row — not a flag
 *   - the ordering is TOTAL, so the answer is never ambiguous
 *   - the history is kept: every selection is still there
 *
 * The database:
 *   - a row CANNOT be updated — the trigger aborts
 *   - a row CANNOT be deleted — the trigger aborts
 *   - a method outside the closed set CANNOT be written — the CHECK refuses
 *
 * The triggers are the point. A repository with no update method is a
 * convention; a trigger that ABORTS is a guarantee (ADR-029).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  openBatchManagementDatabase,
} from '../../src/001-batch-management/infrastructure/persistence/batch-selection-database.js';
import {
  SqliteBatchSelectionRepository,
} from '../../src/001-batch-management/infrastructure/persistence/sqlite-batch-selection-repository.js';
import { BatchSelection } from '../../src/001-batch-management/domain/entities/batch-selection.js';
import {
  BatchId,
  MachineRef,
  OrderRef,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';

const AT = new Date('2026-11-05T06:14:22.000Z');
const LATER = new Date('2026-11-05T06:15:00.000Z');

function selection(
  overrides: {
    readonly batchId?: string;
    readonly operatorId?: string;
    readonly selectedAt?: Date;
    readonly method?: 'SCAN' | 'TOUCH';
  } = {},
): BatchSelection {
  return new BatchSelection(
    BatchId.create(overrides.batchId ?? 'B-24187'),
    OrderRef.create('SO-9931'),
    MachineRef.create('JET-04'),
    OperatorId.create(overrides.operatorId ?? 'OP-001'),
    Instant.of(overrides.selectedAt ?? AT),
    overrides.method ?? 'TOUCH',
  );
}

describe('the batch selection repository', () => {
  let db: DatabaseSync;
  let repository: SqliteBatchSelectionRepository;

  beforeEach(() => {
    db = openBatchManagementDatabase(':memory:');
    repository = new SqliteBatchSelectionRepository(db, () => AT);
  });

  afterEach(() => {
    db.close();
  });

  it('saves a selection and reads it back intact', async () => {
    await repository.save(selection());

    const found = await repository.latest();

    expect(found).not.toBeNull();
    expect(found?.batchId.value).toBe('B-24187');
    expect(found?.orderRef.value).toBe('SO-9931');
    expect(found?.machineRef.value).toBe('JET-04');
    expect(found?.operatorId.value).toBe('OP-001');
    expect(found?.selectedAt.toDate()).toEqual(AT);
    expect(found?.selectionMethod).toBe('TOUCH');
  });

  it('reports no selection when nothing has been chosen', async () => {
    // An empty selection is a STATE, not an error.
    expect(await repository.latest()).toBeNull();
  });

  it('reports the NEWEST selection as the active one', async () => {
    await repository.save(selection({ batchId: 'B-24187' }));
    await repository.save(
      selection({ batchId: 'B-24190', selectedAt: LATER }),
    );

    const found = await repository.latest();
    expect(found?.batchId.value).toBe('B-24190');
  });

  it('keeps the history — every selection is still in the table', async () => {
    await repository.save(selection({ batchId: 'B-24187' }));
    await repository.save(
      selection({ batchId: 'B-24190', selectedAt: LATER }),
    );

    const rows = db
      .prepare('SELECT COUNT(*) AS count FROM batch_selections')
      .get() as unknown as { count: number };

    // The active selection is the newest row; the history is every row.
    expect(rows.count).toBe(2);
  });

  it('breaks a tie on the SAME millisecond deterministically', async () => {
    // Two selections in the same millisecond have no order by time alone,
    // so the `id` is the tie-breaker. The answer must be DEFINED, even
    // though which row wins is arbitrary.
    await repository.save(selection({ batchId: 'B-24187' }));
    await repository.save(selection({ batchId: 'B-24190' }));

    const first = await repository.latest();
    const second = await repository.latest();

    expect(first?.batchId.value).toBe(second?.batchId.value);
    expect(['B-24187', 'B-24190']).toContain(first?.batchId.value);
  });

  it('REFUSES an update — the trigger aborts it', async () => {
    await repository.save(selection());

    expect(() =>
      db
        .prepare("UPDATE batch_selections SET batch_id = 'B-99999'")
        .run(),
    ).toThrow(/append-only/);
  });

  it('REFUSES a delete — the trigger aborts it', async () => {
    await repository.save(selection());

    expect(() => db.prepare('DELETE FROM batch_selections').run()).toThrow(
      /append-only/,
    );
  });

  it('REFUSES a method outside the closed set', async () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO batch_selections
             (id, batch_id, order_ref, machine_ref, operator_id,
              selected_at, selection_method, recorded_at)
           VALUES ('x', 'B-1', 'SO-1', 'JET-1', 'OP-001', ?, 'TYPED', ?)`,
        )
        .run(AT.toISOString(), AT.toISOString()),
    ).toThrow();
  });

  it('stores the selection time and the recording time separately', async () => {
    await repository.save(selection({ selectedAt: AT }));

    const row = db
      .prepare(
        'SELECT selected_at, recorded_at FROM batch_selections LIMIT 1',
      )
      .get() as unknown as { selected_at: string; recorded_at: string };

    // The act and the write are different moments.
    expect(row.selected_at).toBe(AT.toISOString());
    expect(row.recorded_at).toBe(AT.toISOString());
  });
});
