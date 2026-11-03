/**
 * The write path's persistence — the real SQLite.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS WHERE THE ATOMICITY LIVES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The domain tests use stubs, and a stub cannot prove that the ledger's
 * PRIMARY KEY refuses a duplicate **atomically**. Only the database can.
 *
 * So these tests run against the real thing:
 *
 *   - the ledger's primary key refuses a duplicate key
 *   - the guarded UPDATE refuses a double-resolution
 *   - the posting's content is unchanged by a state transition
 *   - the unit of work commits the three writes together, or none
 *   - a rolled-back transaction leaves nothing behind
 *   - there is NO delete path on the ledger
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  openOrgatexDatabase,
  type SqliteDatabase,
} from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import { SqliteIdempotencyLedger } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-posting-repository.js';
import { SqlitePostingAttemptRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-posting-attempt-repository.js';
import { SqliteBatchStatusWriteRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-batch-status-write-repository.js';
import { SqliteUnitOfWork } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-unit-of-work.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { RejectionReason } from '../../src/005-orgatex-integration/domain/value-objects/rejection-reason.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { ConsumptionPosting, PostingAttempt } from '../../src/005-orgatex-integration/domain/entities/postings.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';

const NOW = Instant.of(new Date('2026-11-02T08:14:22.000Z'));

function posting(
  key = 'IDK-cafebabe0badf00d',
  component = 'C-01',
): ConsumptionPosting {
  return new ConsumptionPosting(
    IdempotencyKey.of(key),
    BatchId.create('B-24187'),
    ComponentId.create(component),
    WeightValue.of('94.01', 'g'),
    LotNumber.create('L-77120'),
    OperatorReference.create('OP-001'),
    NOW,
    NOW,
  );
}

describe('the OrgaTEX write path persistence', () => {
  let db: SqliteDatabase;
  let ledger: SqliteIdempotencyLedger;
  let postings: SqlitePostingRepository;
  let attempts: SqlitePostingAttemptRepository;
  let statusWrites: SqliteBatchStatusWriteRepository;
  let unitOfWork: SqliteUnitOfWork;

  beforeEach(() => {
    db = openOrgatexDatabase(':memory:');
    ledger = new SqliteIdempotencyLedger(db);
    postings = new SqlitePostingRepository(db);
    attempts = new SqlitePostingAttemptRepository(db);
    statusWrites = new SqliteBatchStatusWriteRepository(db);
    unitOfWork = new SqliteUnitOfWork(db);
  });

  it('creates the four tables', () => {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as unknown as { name: string }[];

    const tableNames = names.map((row) => row.name);
    expect(tableNames).toContain('consumption_postings');
    expect(tableNames).toContain('idempotency_ledger');
    expect(tableNames).toContain('posting_attempts');
    expect(tableNames).toContain('batch_status_writes');
  });

  it('creates NO table for a batch, a recipe or a snapshot', () => {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as unknown as { name: string }[];

    const tableNames = names.map((row) => row.name);
    expect(tableNames).not.toContain('orgatex_batches');
    expect(tableNames).not.toContain('orgatex_recipes');
    expect(tableNames).not.toContain('orgatex_snapshots');
  });

  it('applies its migrations only once', () => {
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get() as unknown as { n: number };

    // Re-opening with the same handle applies nothing new.
    openOrgatexDatabase(':memory:', db);

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get() as unknown as { n: number };

    expect(after.n).toBe(before.n);
  });

  describe('the idempotency ledger', () => {
    it('records a key', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      // The ledger's row references its posting, so the posting must
      // exist first.
      await postings.save(posting());
      await ledger.record(key, key, NOW);
      expect(await ledger.has(key)).toBe(true);
    });

    it('refuses a duplicate key with a UNIQUE violation', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());
      await ledger.record(key, key, NOW);

      await expect(ledger.record(key, key, NOW)).rejects.toThrow(
        /UNIQUE constraint failed/,
      );
    });

    it('refuses a duplicate with the ledger constraint named', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());
      await ledger.record(key, key, NOW);

      await expect(ledger.record(key, key, NOW)).rejects.toThrow(
        /idempotency_ledger\.idempotency_key/,
      );
    });

    it('refuses a ledger row for a posting that does not exist', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await expect(ledger.record(key, key, NOW)).rejects.toThrow(
        /FOREIGN KEY constraint failed/,
      );
    });

    it('has NO delete method', () => {
      // The absence is the enforcement (ADR-023). A key is consumed
      // forever (BRD DR-01).
      const methods = Object.getOwnPropertyNames(
        SqliteIdempotencyLedger.prototype,
      );
      expect(methods).not.toContain('delete');
      expect(methods).not.toContain('remove');
      expect(methods).not.toContain('purge');
    });

    it('finds the posting a key was recorded for', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());
      await ledger.record(key, key, NOW);

      expect((await ledger.find(key))?.value).toBe(key.value);
    });

    it('finds nothing for a key that was never recorded', async () => {
      expect(await ledger.find(IdempotencyKey.of('IDK-cafebabe0badf00d'))).toBeNull();
    });
  });

  describe('the postings table', () => {
    it('stores the quantity as TEXT, not as a float', async () => {
      await postings.save(posting());

      const row = db
        .prepare(
          'SELECT typeof(actual_quantity) AS t, actual_quantity FROM consumption_postings',
        )
        .get() as unknown as { t: string; actual_quantity: string };

      expect(row.t).toBe('text');
      expect(row.actual_quantity).toBe('94.01');
    });

    it('reads the quantity back exactly', async () => {
      await postings.save(posting());
      const found = await postings.findById(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
      );

      expect(found?.actualQuantity.toJSON()).toBe('94.01');
      expect(found?.actualQuantity.unit).toBe('g');
    });

    it('leaves the content unchanged when the posting is accepted', async () => {
      await postings.save(posting());
      await postings.markAccepted(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
        NOW,
      );

      const found = await postings.findById(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
      );

      expect(found?.actualQuantity.toJSON()).toBe('94.01');
      expect(found?.batchId.value).toBe('B-24187');
      expect(found?.componentId.value).toBe('C-01');
      expect(found?.lotNumber.value).toBe('L-77120');
      expect(found?.operatorId.value).toBe('OP-001');
      expect(found?.weighedAt.epochMillis).toBe(NOW.epochMillis);
    });

    it('refuses a double-acceptance', async () => {
      await postings.save(posting());
      await postings.markAccepted(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
        NOW,
      );

      await expect(
        postings.markAccepted(
          IdempotencyKey.of('IDK-cafebabe0badf00d'),
          NOW,
        ),
      ).rejects.toThrow(/not in state QUEUED/);
    });

    it('refuses a double-rejection', async () => {
      await postings.save(posting());
      await postings.markRejected(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
        RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
        NOW,
      );

      await expect(
        postings.markRejected(
          IdempotencyKey.of('IDK-cafebabe0badf00d'),
          RejectionReason.of('BATCH_NOT_POSTABLE', 'closed again'),
          NOW,
        ),
      ).rejects.toThrow(/not in state QUEUED/);
    });

    it('refuses a rejection after an acceptance', async () => {
      await postings.save(posting());
      await postings.markAccepted(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
        NOW,
      );

      await expect(
        postings.markRejected(
          IdempotencyKey.of('IDK-cafebabe0badf00d'),
          RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
          NOW,
        ),
      ).rejects.toThrow(/not in state QUEUED/);
    });

    it('retains the rejection reason on the posting', async () => {
      await postings.save(posting());
      await postings.markRejected(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
        RejectionReason.of('BATCH_NOT_POSTABLE', 'the batch is closed'),
        NOW,
      );

      const found = await postings.findById(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
      );

      expect(found?.state).toBe('REJECTED');
      expect(found?.rejection?.code).toBe('BATCH_NOT_POSTABLE');
      expect(found?.rejection?.detail).toBe('the batch is closed');
    });

    it('has NO general update method', () => {
      const methods = Object.getOwnPropertyNames(
        SqlitePostingRepository.prototype,
      );
      expect(methods).not.toContain('update');
    });

    it('finds a batch’s postings in creation order', async () => {
      await postings.save(posting('IDK-0000000000000001', 'C-01'));
      await postings.save(posting('IDK-0000000000000002', 'C-02'));

      const found = await postings.findByBatch(BatchId.create('B-24187'));
      expect(found.map((p) => p.componentId.value)).toEqual(['C-01', 'C-02']);
    });

    it('finds NO postings for a batch that has none', async () => {
      const found = await postings.findByBatch(BatchId.create('B-99999'));
      expect(found).toEqual([]);
    });

    it('finds nothing for a key that has no posting', async () => {
      expect(
        await postings.findById(IdempotencyKey.of('IDK-cafebabe0badf00d')),
      ).toBeNull();
    });

    it('refuses a second posting with the same key', async () => {
      await postings.save(posting());
      await expect(postings.save(posting())).rejects.toThrow(
        /UNIQUE constraint failed/,
      );
    });
  });

  describe('the attempt history', () => {
    it('appends an attempt', async () => {
      await postings.save(posting());
      await attempts.append(
        new PostingAttempt(
          'ATT-1',
          IdempotencyKey.of('IDK-cafebabe0badf00d'),
          NOW,
          'UNKNOWN',
        ),
      );

      const found = await attempts.findByPosting(
        IdempotencyKey.of('IDK-cafebabe0badf00d'),
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.outcome).toBe('UNKNOWN');
    });

    it('has NO update and NO delete method', () => {
      const methods = Object.getOwnPropertyNames(
        SqlitePostingAttemptRepository.prototype,
      );
      expect(methods).not.toContain('update');
      expect(methods).not.toContain('delete');
    });
  });

  describe('the unit of work', () => {
    it('commits the posting, the attempt and the ledger together', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());

      await unitOfWork.commit({
        kind: 'ACCEPTED',
        posting: posting(),
        attempt: new PostingAttempt('ATT-1', key, NOW, 'ACCEPTED'),
        ledgerKey: key,
        ledgerAt: NOW,
      });

      expect((await postings.findById(key))?.state).toBe('ACCEPTED');
      expect(await ledger.has(key)).toBe(true);
      expect(await attempts.findByPosting(key)).toHaveLength(1);
    });

    it('rolls back everything when the ledger refuses the key', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());
      await ledger.record(key, key, NOW);

      await expect(
        unitOfWork.commit({
          kind: 'ACCEPTED',
          posting: posting(),
          attempt: new PostingAttempt('ATT-1', key, NOW, 'ACCEPTED'),
          ledgerKey: key,
          ledgerAt: NOW,
        }),
      ).rejects.toThrow(/UNIQUE constraint failed/);

      // The state transition was rolled back with the insert.
      expect((await postings.findById(key))?.state).toBe('QUEUED');
      // And the attempt was rolled back too.
      expect(await attempts.findByPosting(key)).toHaveLength(0);
    });

    it('does NOT write the ledger for a pending posting', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());

      await unitOfWork.commit({
        kind: 'PENDING',
        posting: posting(),
        attempt: new PostingAttempt('ATT-1', key, NOW, 'UNREACHABLE'),
      });

      expect((await postings.findById(key))?.state).toBe('QUEUED');
      expect(await ledger.has(key)).toBe(false);
      expect(await attempts.findByPosting(key)).toHaveLength(1);
    });

    it('records the reason on a rejected posting and keeps the attempt', async () => {
      const key = IdempotencyKey.of('IDK-cafebabe0badf00d');
      await postings.save(posting());
      const reason = RejectionReason.of('BATCH_NOT_POSTABLE', 'closed');

      await unitOfWork.commit({
        kind: 'REJECTED',
        posting: posting(),
        attempt: new PostingAttempt('ATT-1', key, NOW, 'REJECTED', reason),
      });

      const found = await postings.findById(key);
      expect(found?.state).toBe('REJECTED');
      expect(found?.rejection?.code).toBe('BATCH_NOT_POSTABLE');
      expect(await attempts.findByPosting(key)).toHaveLength(1);
    });
  });

  describe('the batch status writes', () => {
    it('stores a status write and resolves it', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-1',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);
      await statusWrites.markAccepted('BSW-1', NOW);

      const found = await statusWrites.findById('BSW-1');
      expect(found?.state).toBe('ACCEPTED');
      expect(found?.status).toBe('WEIGHED');
    });

    it('refuses a double-acceptance', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-1',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);
      await statusWrites.markAccepted('BSW-1', NOW);

      await expect(statusWrites.markAccepted('BSW-1', NOW)).rejects.toThrow(
        /not in state QUEUED/,
      );
    });

    it('has NO general update method', () => {
      const methods = Object.getOwnPropertyNames(
        SqliteBatchStatusWriteRepository.prototype,
      );
      expect(methods).not.toContain('update');
    });

    it('retains the reason on a rejected status write', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-2',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);
      await statusWrites.markRejected(
        'BSW-2',
        RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
        NOW,
      );

      const found = await statusWrites.findById('BSW-2');
      expect(found?.state).toBe('REJECTED');
      expect(found?.rejection?.code).toBe('BATCH_NOT_POSTABLE');
    });

    it('finds NO status write for an id that has none', async () => {
      expect(await statusWrites.findById('BSW-999')).toBeNull();
    });

    it('finds a batch’s status writes in order', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      await statusWrites.save(
        new BatchStatusWrite('BSW-1', BatchId.create('B-24187'), 'WEIGHED', NOW),
      );
      await statusWrites.save(
        new BatchStatusWrite('BSW-2', BatchId.create('B-24187'), 'WEIGHED', NOW),
      );

      const found = await statusWrites.findByBatch(BatchId.create('B-24187'));
      expect(found.map((w) => w.id)).toEqual(['BSW-1', 'BSW-2']);
    });

    it('commits a status write and its outcome together', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-3',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);

      await unitOfWork.commitStatusWrite({ kind: 'ACCEPTED', write });

      expect((await statusWrites.findById('BSW-3'))?.state).toBe('ACCEPTED');
    });

    it('commits a rejected status write with its reason', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-4',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);

      await unitOfWork.commitStatusWrite({
        kind: 'REJECTED',
        write,
        reason: RejectionReason.of('BATCH_NOT_POSTABLE', 'closed'),
      });

      expect((await statusWrites.findById('BSW-4'))?.state).toBe('REJECTED');
    });

    it('leaves a pending status write QUEUED', async () => {
      const { BatchStatusWrite } = await import(
        '../../src/005-orgatex-integration/domain/entities/postings.js'
      );
      const write = new BatchStatusWrite(
        'BSW-5',
        BatchId.create('B-24187'),
        'WEIGHED',
        NOW,
      );
      await statusWrites.save(write);

      await unitOfWork.commitStatusWrite({ kind: 'PENDING', write });

      expect((await statusWrites.findById('BSW-5'))?.state).toBe('QUEUED');
    });
  });

  describe('the schema', () => {
    it('makes the ledger key the PRIMARY KEY', () => {
      const rows = db
        .prepare('PRAGMA table_info(idempotency_ledger)')
        .all() as unknown as { name: string; pk: number }[];

      const key = rows.find((row) => row.name === 'idempotency_key');
      expect(key?.pk).toBe(1);
    });

    it('makes the posting id the PRIMARY KEY', () => {
      const rows = db
        .prepare('PRAGMA table_info(consumption_postings)')
        .all() as unknown as { name: string; pk: number }[];

      const id = rows.find((row) => row.name === 'id');
      expect(id?.pk).toBe(1);
    });

    it('constrains the posting state to the three states', async () => {
      await postings.save(posting());
      expect(() =>
        db
          .prepare(
            "UPDATE consumption_postings SET state = 'SOMETHING_ELSE' WHERE id = ?",
          )
          .run('IDK-cafebabe0badf00d'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('constrains the attempt outcome to the four outcomes', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO posting_attempts (id, posting_id, attempted_at, outcome)
             VALUES ('ATT-9', 'IDK-cafebabe0badf00d', ?, 'MAYBE')`,
          )
          .run(NOW.toDate().toISOString()),
      ).toThrow(/CHECK constraint failed/);
    });
  });
});

describe('a database shared with another unit', () => {
  it('applies its migrations to an existing handle', () => {
    const shared = new DatabaseSync(':memory:');
    shared.exec(
      'CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );

    const db = openOrgatexDatabase(':memory:', shared);

    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'consumption_postings'",
      )
      .all() as unknown as { name: string }[];
    expect(rows).toHaveLength(1);
  });
});
