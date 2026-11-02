/**
 * The composition root — where the OrgaTEX unit's layers are wired.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE `Q-01` SEAM IS BOUND HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `DummyOrgatexAdapter` is bound to the `OrgatexAdapter` port. When FCI
 * confirms the MES's interface, this is the line that changes — plus one
 * new adapter class. Nothing else in the product changes.
 *
 * THE WORLD IS SHARED WITH THE DUMMY MES's ROUTER
 * -----------------------------------------------
 * The adapter and the Dummy MES's HTTP router are given the **same**
 * `DummyOrgatexWorld` instance, so a batch added through the router is
 * immediately visible to the adapter. There is one copy of the data, so the
 * two cannot drift (ADR-022).
 *
 * THE COMPOSITION ROOT KNOWS NOTHING OF EXPRESS
 * --------------------------------------------
 * The Dummy MES's router is built by the caller, from `module.world`. The
 * wiring layer wires **domains**; the HTTP layer mounts **routes**. Keeping
 * the presentation layer out of here means the composition root can be
 * exercised without a web server at all.
 */
import { BatchQueueReader } from '../domain/services/batch-queue-reader.js';
import { RecipeReader } from '../domain/services/recipe-reader.js';
import { SnapshotCache } from '../domain/services/snapshot-cache.js';
import { ConsumptionPostingService } from '../domain/services/consumption-posting-service.js';
import { BatchStatusWriteService } from '../domain/services/batch-status-write-service.js';
import type { OrgatexAdapter } from '../domain/ports/orgatex-adapter.js';
import type { OrgatexEvent } from '../domain/events/orgatex-events.js';
import type { PostingEvent } from '../domain/events/posting-events.js';
import { DummyOrgatexAdapter } from './adapters/dummy-orgatex-adapter.js';
import { DummyOrgatexWorld } from './adapters/dummy-orgatex-data.js';
import { openOrgatexDatabase, type SqliteDatabase } from './persistence/orgatex-database.js';
import { SqliteIdempotencyLedger } from './persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from './persistence/sqlite-posting-repository.js';
import { SqlitePostingAttemptRepository } from './persistence/sqlite-posting-attempt-repository.js';
import { SqliteBatchStatusWriteRepository } from './persistence/sqlite-batch-status-write-repository.js';
import { SqliteUnitOfWork } from './persistence/sqlite-unit-of-work.js';
import type { OrgatexConfig } from './config/orgatex-config.js';

export interface OrgatexModule {
  readonly adapter: OrgatexAdapter;
  readonly world: DummyOrgatexWorld;
  readonly cache: SnapshotCache;
  readonly queueReader: BatchQueueReader;
  readonly recipeReader: RecipeReader;
  readonly postingService: ConsumptionPostingService;
  readonly statusWriteService: BatchStatusWriteService;
  readonly ledger: SqliteIdempotencyLedger;
  readonly postings: SqlitePostingRepository;
  readonly attempts: SqlitePostingAttemptRepository;
  readonly statusWrites: SqliteBatchStatusWriteRepository;
  readonly unitOfWork: SqliteUnitOfWork;
  readonly database: SqliteDatabase;
}

export interface BuildOrgatexOptions {
  readonly config: OrgatexConfig;
  readonly clock?: () => Date;
  /** An existing adapter, so a test can bind a different one. */
  readonly adapter?: OrgatexAdapter;
  /** An existing world, so a test can share one with a router. */
  readonly world?: DummyOrgatexWorld;
  /** An existing database, so the unit can share one with the others. */
  readonly db?: SqliteDatabase;
  readonly onEvent?: (event: OrgatexEvent) => void;
  readonly onPostingEvent?: (event: PostingEvent) => void;
}

export function buildOrgatexModule(
  options: BuildOrgatexOptions,
): OrgatexModule {
  const { config } = options;
  const clock = options.clock ?? (() => new Date());

  // The world and the adapter are created together, and the Dummy MES's
  // router is given the SAME world — so the training artefact and the
  // product's read path can never disagree about the data.
  const world = options.world ?? new DummyOrgatexWorld();
  const adapter =
    options.adapter ?? new DummyOrgatexAdapter(world, config.sourceName);

  const cache = new SnapshotCache();

  // `exactOptionalPropertyTypes` is on, so an absent `onEvent` must be
  // ABSENT from the options object — not present and undefined.
  const shared = {
    adapter,
    cache,
    clock,
    source: config.sourceName,
    freshnessWindowMs: config.freshnessWindowMs,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  };

  const queueReader = new BatchQueueReader(shared);

  const recipeReader = new RecipeReader(shared);

  // ── The write path ─────────────────────────────────────────────────
  // The database is SHARED with the other units — the identity and scale
  // units use the same file — so the migrations go through the same
  // `schema_migrations` table.
  const database = openOrgatexDatabase(
    config.databasePath,
    options.db,
  );

  const ledger = new SqliteIdempotencyLedger(database);
  const postings = new SqlitePostingRepository(database);
  const attempts = new SqlitePostingAttemptRepository(database);
  const statusWrites = new SqliteBatchStatusWriteRepository(database);
  const unitOfWork = new SqliteUnitOfWork(database);

  // The attempt and write ids are generated here rather than in the
  // domain, because they are storage identifiers — not business
  // identity. The KEY is the business identity, and that is derived in
  // the domain.
  let sequence = 0;
  const newId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
  };

  const postingService = new ConsumptionPostingService({
    adapter,
    ledger,
    postings,
    unitOfWork,
    clock,
    newAttemptId: () => newId('ATT'),
    ...(options.onPostingEvent === undefined
      ? {}
      : { onEvent: options.onPostingEvent }),
  });

  const statusWriteService = new BatchStatusWriteService({
    adapter,
    postings,
    writes: statusWrites,
    unitOfWork,
    clock,
    newWriteId: () => newId('BSW'),
    ...(options.onPostingEvent === undefined
      ? {}
      : { onEvent: options.onPostingEvent }),
  });

  return {
    adapter,
    world,
    cache,
    queueReader,
    recipeReader,
    postingService,
    statusWriteService,
    ledger,
    postings,
    attempts,
    statusWrites,
    unitOfWork,
    database,
  };
}
