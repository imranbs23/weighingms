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
import { LinkStateService } from '../domain/services/link-state-service.js';
import { PureLinkStatePolicy } from '../domain/services/link-state-policy.js';
import { PureSyncBackoffPolicy } from '../domain/services/sync-backoff-policy.js';
import { SyncQueueService } from '../domain/services/sync-queue-service.js';
import { SyncRetryWorker } from '../domain/services/sync-retry-worker.js';
import type { OrgatexAdapter } from '../domain/ports/orgatex-adapter.js';
import type { OrgatexEvent } from '../domain/events/orgatex-events.js';
import type { PostingEvent } from '../domain/events/posting-events.js';
import type { LinkEvent } from '../domain/events/link-events.js';
import type { SyncQueueEvent } from '../domain/events/sync-queue-events.js';
import { DummyOrgatexAdapter } from './adapters/dummy-orgatex-adapter.js';
import { DummyOrgatexWorld } from './adapters/dummy-orgatex-data.js';
import { NodeLinkFreshnessScheduler } from './adapters/node-link-freshness-scheduler.js';
import { openOrgatexDatabase, type SqliteDatabase } from './persistence/orgatex-database.js';
import { SqliteIdempotencyLedger } from './persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from './persistence/sqlite-posting-repository.js';
import { SqlitePostingAttemptRepository } from './persistence/sqlite-posting-attempt-repository.js';
import { SqliteBatchStatusWriteRepository } from './persistence/sqlite-batch-status-write-repository.js';
import { SqliteSyncQueueRepository } from './persistence/sqlite-sync-queue-repository.js';
import { SqliteLinkContactRepository } from './persistence/sqlite-link-contact-repository.js';
import { SqliteLinkTransitionRepository } from './persistence/sqlite-link-transition-repository.js';
import { SqliteUnitOfWork } from './persistence/sqlite-unit-of-work.js';
import { FreshnessWindow } from '../domain/value-objects/freshness-window.js';
import type { LinkContactReporter } from '../domain/ports/link-repositories.js';
import type { OrgatexConfig } from './config/orgatex-config.js';

export interface OrgatexModule {
  readonly adapter: OrgatexAdapter;
  readonly world: DummyOrgatexWorld;
  readonly cache: SnapshotCache;
  readonly queueReader: BatchQueueReader;
  readonly recipeReader: RecipeReader;
  readonly postingService: ConsumptionPostingService;
  readonly statusWriteService: BatchStatusWriteService;
  readonly linkStateService: LinkStateService;
  readonly syncQueueService: SyncQueueService;
  readonly syncRetryWorker: SyncRetryWorker;
  readonly syncQueue: SqliteSyncQueueRepository;
  readonly linkContacts: SqliteLinkContactRepository;
  readonly linkTransitions: SqliteLinkTransitionRepository;
  readonly linkScheduler: NodeLinkFreshnessScheduler;
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
  readonly onLinkEvent?: (event: LinkEvent) => void;
  readonly onSyncQueueEvent?: (event: SyncQueueEvent) => void;
  /**
   * Start the retry worker.
   *
   * Off by default, so a test can drive the queue deterministically. The
   * server turns it on.
   */
  readonly startRetryWorker?: boolean;
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

  // ── The link state and the sync queue (bolt 007) ───────────────────
  // These are built FIRST, because the readers and the posting service
  // both REPORT their contact outcomes to the link state service. The
  // service is the single writer of the observation row (OQ-5, R-08), so
  // it has to exist before anything that talks to the MES.
  const syncQueue = new SqliteSyncQueueRepository(database);
  const linkContacts = new SqliteLinkContactRepository(database);
  const linkTransitions = new SqliteLinkTransitionRepository(database);

  // A failed scheduled evaluation must be VISIBLE, and must never become
  // an unhandled rejection — Node terminates the process on those by
  // default. So both timers report their failures to the log.
  const reportScheduledFailure = (error: unknown): void => {
    console.error('[orgatex] scheduled link evaluation failed:', error);
  };

  const linkScheduler = new NodeLinkFreshnessScheduler(reportScheduledFailure);

  // The freshness window is the SAME number bolt 005's read path uses —
  // one env var, one concept. It is wrapped in a value object here so
  // the domain never sees a bare millisecond count.
  const freshnessWindow = FreshnessWindow.of(config.freshnessWindowMs);

  const linkStateService = new LinkStateService({
    policy: new PureLinkStatePolicy(),
    contacts: linkContacts,
    transitions: linkTransitions,
    scheduler: linkScheduler,
    freshnessWindow,
    clock,
    ...(options.onLinkEvent === undefined
      ? {}
      : { onEvent: options.onLinkEvent }),
  });

  // The narrow port the MES-contacting paths report through. The service
  // is bound to it — so the readers depend on two methods, not on the
  // whole service.
  const contactReporter: LinkContactReporter = {
    recordSuccess: (at) => linkStateService.recordSuccess(at).then(() => {}),
    recordFailure: (error, at) =>
      linkStateService.recordFailure(error, at).then(() => {}),
  };

  // `exactOptionalPropertyTypes` is on, so an absent `onEvent` must be
  // ABSENT from the options object — not present and undefined.
  const shared = {
    adapter,
    cache,
    clock,
    source: config.sourceName,
    freshnessWindowMs: config.freshnessWindowMs,
    contactReporter,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  };

  const queueReader = new BatchQueueReader(shared);

  const recipeReader = new RecipeReader(shared);

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
    contactReporter,
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

  // ── The sync queue (bolt 007) ─────────────────────────────────────
  const syncQueueService = new SyncQueueService({
    postingService,
    queue: syncQueue,
    postings,
    ledger,
    linkState: linkStateService,
    // The disposition is CONSUMED from bolt 006's configuration, never
    // re-decided here (ADR-026).
    disposition: {
      disposition: () => config.rejectionDisposition,
    },
    backoffPolicy: new PureSyncBackoffPolicy(),
    backoff: config.syncBackoff,
    clock,
    ...(options.onSyncQueueEvent === undefined
      ? {}
      : { onEvent: options.onSyncQueueEvent }),
  });

  const syncRetryWorker = new SyncRetryWorker({
    queue: syncQueueService,
    intervalMs: config.syncRetryIntervalMs,
    clock,
    onError: reportScheduledFailure,
  });

  if (options.startRetryWorker === true) {
    syncRetryWorker.start();
  }

  return {
    adapter,
    world,
    cache,
    queueReader,
    recipeReader,
    postingService,
    statusWriteService,
    linkStateService,
    syncQueueService,
    syncRetryWorker,
    syncQueue,
    linkContacts,
    linkTransitions,
    linkScheduler,
    ledger,
    postings,
    attempts,
    statusWrites,
    unitOfWork,
    database,
  };
}
