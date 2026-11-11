/**
 * Test harness — builds a real identity module against an in-memory
 * database.
 *
 * The tests deliberately exercise the REAL adapters (real Argon2id, real
 * SQLite) rather than mocks. This unit is the one the unit brief says
 * must be "exercised by an exhaustive test suite independent of the other
 * units" — a mock-based suite would test the mocks.
 *
 * The one concession is the CLOCK. Sessions expire on wall-clock time, and
 * a test that waits eight hours is not a test. The clock is therefore
 * injected — which is also how the design made session lifetime
 * configurable rather than hard-coded.
 */
import { createApp } from '../src/api/app.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildTicketModule,
  type TicketModule,
} from '../src/006-ticket-printing/infrastructure/composition-root.js';
import {
  OrgatexBatchIdentityAdapter,
  DefaultTicketConfiguration,
} from '../src/006-ticket-printing/infrastructure/adapters/batch-identity-adapter.js';
import {
  writeLocaleBundles,
} from './support/locale-bundles.js';
import {
  buildIdentityModule,
  type IdentityModule,
} from '../src/008-operator-identity/infrastructure/composition-root.js';
import type { IdentityConfig } from '../src/008-operator-identity/infrastructure/config/identity-config.js';
import { OperatorId } from '../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../src/008-operator-identity/domain/value-objects/operator-role.js';
import { Operator } from '../src/008-operator-identity/domain/entities/operator.js';
import {
  buildScaleModule,
  type ScaleModule,
} from '../src/004-scale-integration/infrastructure/composition-root.js';
import type { ScaleConfig } from '../src/004-scale-integration/infrastructure/config/scale-config.js';
import { WeightValue } from '../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  buildOrgatexModule,
  type OrgatexModule,
} from '../src/005-orgatex-integration/infrastructure/composition-root.js';
import type { OrgatexConfig } from '../src/005-orgatex-integration/infrastructure/config/orgatex-config.js';
import { BackoffSchedule } from '../src/005-orgatex-integration/domain/value-objects/backoff-schedule.js';
import {
  buildBatchManagementModule,
  type BatchManagementModule,
} from '../src/001-batch-management/infrastructure/composition-root.js';
import {
  openBatchManagementDatabase,
} from '../src/001-batch-management/infrastructure/persistence/batch-selection-database.js';
import {
  SqliteBatchSelectionRepository,
} from '../src/001-batch-management/infrastructure/persistence/sqlite-batch-selection-repository.js';
import {
  DummyBatchScanner,
} from '../src/001-batch-management/infrastructure/adapters/dummy-batch-scanner.js';
import {
  buildRecipeMaterialModule,
  type RecipeMaterialModule,
} from '../src/002-recipe-material-management/infrastructure/composition-root.js';
import {
  RecipeWorkingCopy,
} from '../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import {
  OrgatexDyestuffMasterAdapter,
} from '../src/002-recipe-material-management/infrastructure/adapters/orgatex-dyestuff-master-adapter.js';
import {
  openMaterialDatabase,
} from '../src/002-recipe-material-management/infrastructure/persistence/material-database.js';
import {
  SqliteMaterialIdentityRepository,
} from '../src/002-recipe-material-management/infrastructure/persistence/sqlite-material-identity-repository.js';
import {
  SqliteMaterialLotRepository,
} from '../src/002-recipe-material-management/infrastructure/persistence/sqlite-material-lot-repository.js';
import {
  openContainerDatabase,
} from '../src/002-recipe-material-management/infrastructure/persistence/container-database.js';
import {
  SqliteContainerAssignmentRepository,
} from '../src/002-recipe-material-management/infrastructure/persistence/sqlite-container-assignment-repository.js';
import {
  SqliteContainerMasterRepository,
} from '../src/002-recipe-material-management/infrastructure/persistence/sqlite-container-master-repository.js';
import {
  ScaleTareAdapter,
} from '../src/002-recipe-material-management/infrastructure/adapters/scale-tare-adapter.js';
import {
  buildWeighingStationModule,
  type WeighingStationModule,
} from '../src/003-weighing-station/infrastructure/composition-root.js';
import {
  ScaleSelectionAdapter,
} from '../src/003-weighing-station/infrastructure/adapters/scale-selection-adapter.js';
import {
  openSessionDatabase,
} from '../src/003-weighing-station/infrastructure/persistence/session-database.js';
import {
  SqliteWeighingSessionRepository,
} from '../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-session-repository.js';
import {
  openRecordDatabase,
} from '../src/003-weighing-station/infrastructure/persistence/record-database.js';
import {
  SqliteWeighingRecordRepository,
} from '../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-record-repository.js';
import {
  openProposalDatabase,
} from '../src/003-weighing-station/infrastructure/persistence/proposal-database.js';
import {
  SqliteSurplusProposalRepository,
} from '../src/003-weighing-station/infrastructure/persistence/sqlite-surplus-proposal-repository.js';
import {
  openOverrideDatabase,
} from '../src/003-weighing-station/infrastructure/persistence/override-database.js';
import {
  SqliteOverrideRecordRepository,
} from '../src/003-weighing-station/infrastructure/persistence/sqlite-override-record-repository.js';
import {
  ScaleStreamAdapter,
} from '../src/003-weighing-station/infrastructure/adapters/scale-stream-adapter.js';
import {
  OrgatexWriteBackAdapter,
  OrgatexBatchFactsAdapter,
} from '../src/003-weighing-station/infrastructure/adapters/orgatex-write-back-adapter.js';
import type { DummyOrgatexWorld } from '../src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.js';

/** A controllable clock. */
export class TestClock {
  private current: Date;

  constructor(start: Date = new Date('2026-10-30T08:00:00.000Z')) {
    this.current = start;
  }

  now = (): Date => new Date(this.current);

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

export interface Harness {
  readonly identity: IdentityModule;
  readonly scales: ScaleModule;
  readonly orgatex: OrgatexModule;
  readonly batches: BatchManagementModule;
  /**
   * The station's recipe (unit 002).
   *
   * It reads the MES ONLY through unit 005's `RecipeReader` — the REAL
   * reader over the REAL Dummy OrgaTEX — so the test exercises the real
   * seam rather than a double (ADR-032).
   */
  readonly recipes: RecipeMaterialModule;
  /**
   * The recipe **working copy** — unit 002's.
   *
   * A test reads the component's target and tolerance from it, because
   * those are the recipe's facts and the station does not copy them.
   */
  readonly recipeWorkingCopy: RecipeWorkingCopy;
  /**
   * The weighing session (unit 003).
   *
   * It reads the recipe through unit 002's working copy and the rule
   * through unit 004's registry — the REAL ones, so the test exercises the
   * real seam rather than a double.
   */
  readonly station: WeighingStationModule;
  /**
   * The ticket printing (unit 006).
   *
   * It reads the session's confirmed records through unit 003's own
   * repository — so the ticket's quantities are the records' own strings.
   */
  readonly tickets: TicketModule;
  /**
   * The scanner the selection's scan path reads through.
   *
   * Exposed so a test can present a code — or disconnect the device —
   * without reaching into the module.
   */
  readonly scanner: DummyBatchScanner;
  readonly app: ReturnType<typeof createApp>;
  readonly clock: TestClock;
  close(): void;
}

/**
 * Build an identity module on an in-memory database.
 *
 * The Argon2 cost is REDUCED for tests. The real profile (19 MiB, 2
 * passes) costs ~55 ms per verification, and the constant-work test
 * performs dozens of verifications — the suite would take minutes.
 *
 * This does NOT weaken what is being tested: the enumeration defence
 * depends on the two paths doing the SAME amount of work, not on the
 * work being expensive. The cost parameters are covered by their own
 * test against the real profile.
 */
export function createHarness(options?: {
  sessionLifetimeMs?: number;
  argon2Memory?: number;
  argon2Passes?: number;
  authorisationLifetimeMs?: number;
  disconnectTimeoutMs?: number;
  sampleIntervalMs?: number;
  /**
   * The selection threshold, or null to leave it unset.
   *
   * Null is the production default, because `Q-04` is unanswered
   * (ADR-019). A test that needs the threshold configured passes one.
   */
  selectionThreshold?: WeightValue | null;
  /**
   * How old a last known-good OrgaTEX snapshot may be and still be served
   * as stale. A test that needs a stale snapshot passes a small number.
   */
  orgatexFreshnessWindowMs?: number;
  /**
   * Whether a rejected consumption may be re-driven.
   *
   * `RETRYABLE` (the default) keeps a rejected entry on the automatic
   * path. `PERMANENT` takes it off — the entry becomes `FAILED` and waits
   * for an operator. It is configuration (ADR-026), and a test that needs
   * the other behaviour passes one here.
   */
  orgatexRejectionDisposition?: 'RETRYABLE' | 'PERMANENT';
  /**
   * The OrgaTEX world to build the seam over.
   *
   * The default is the world with the prototype's four seed batches. A
   * test that needs a different world — an **empty** one, for the empty
   * queue — passes one here, so the scenario is exercised through the
   * REAL seam rather than by injecting rows.
   */
  orgatexWorld?: DummyOrgatexWorld;
}): Harness {
  const clock = new TestClock();

  const config: IdentityConfig = {
    databasePath: ':memory:',
    sessionLifetimeMs: options?.sessionLifetimeMs ?? 60 * 60 * 1000,
    argon2Memory: options?.argon2Memory ?? 8192,
    argon2Passes: options?.argon2Passes ?? 1,
    authorisationLifetimeMs: options?.authorisationLifetimeMs ?? 15 * 60 * 1000,
  };

  const identity = buildIdentityModule({ config, clock: clock.now });

  // The scale unit shares the identity unit's database, so the two units'
  // migrations live in one `schema_migrations` table.
  const scaleConfig: ScaleConfig = {
    databasePath: ':memory:',
    disconnectTimeoutMs: options?.disconnectTimeoutMs ?? 2000,
    sampleIntervalMs: options?.sampleIntervalMs ?? 100,
    // `Q-04` is unanswered, so the threshold is UNSET — exactly as it is
    // in production (ADR-019). A test that needs it configured passes one
    // here.
    selectionThreshold: options?.selectionThreshold ?? null,
  };
  const scales = buildScaleModule({
    config: scaleConfig,
    clock: clock.now,
    db: identity.db,
  });

  // The OrgaTEX unit's READ path persists nothing (ADR-021). Its WRITE
  // path does — so it shares the identity unit's database file, and its
  // migrations go through the same `schema_migrations` table.
  const orgatexConfig: OrgatexConfig = {
    databasePath: ':memory:',
    freshnessWindowMs: options?.orgatexFreshnessWindowMs ?? 5 * 60 * 1000,
    sourceName: 'DUMMY_ORGATEX',
    rejectionDisposition:
      options?.orgatexRejectionDisposition ?? 'RETRYABLE',
    syncBackoff: BackoffSchedule.defaults(),
    syncRetryIntervalMs: 5000,
  };
  const orgatex = buildOrgatexModule({
    config: orgatexConfig,
    clock: clock.now,
    db: identity.db,
    ...(options?.orgatexWorld === undefined
      ? {}
      : { world: options.orgatexWorld }),
  });

  // The station's own batch queue (unit 001). It reads the MES ONLY through
  // unit 005's reader — bound here, in the one place the two units meet
  // (ADR-028). The harness deliberately uses the REAL reader, so the test
  // exercises the real seam rather than a double.
  //
  // The SELECTION is persisted — unlike the queue — because a selection
  // cannot be re-derived and it is a traceability record (ADR-029). It
  // shares the identity unit's database, so all four units' migrations
  // live in one `schema_migrations` table.
  const scanner = new DummyBatchScanner();
  const batches = buildBatchManagementModule({
    source: orgatex.queueReader,
    scanner,
    selections: new SqliteBatchSelectionRepository(
      openBatchManagementDatabase(':memory:', identity.db),
      clock.now,
    ),
    clock: clock.now,
  });

  // The station's recipe and materials (unit 002). The recipe reads the MES
  // ONLY through unit 005's `RecipeReader` — the REAL reader over the REAL
  // Dummy OrgaTEX — so the test exercises the real seam rather than a
  // double (ADR-032).
  //
  // The SCANNER is the SAME instance unit 001 uses — one physical device,
  // one state, one training artefact (ADR-033). A test presents a code
  // and both units' scan paths see it.
  //
  // The recipe persists NOTHING (ADR-031); the identity and the lot
  // capture DO (ADR-034).
  const recipesWorkingCopy = new RecipeWorkingCopy();
  const containerMaster = new SqliteContainerMasterRepository(
    openContainerDatabase(':memory:', identity.db),
  );
  containerMaster.seedSync();
  const recipes = buildRecipeMaterialModule({
    source: orgatex.recipeReader,
    scanner,
    workingCopy: recipesWorkingCopy,
    master: new OrgatexDyestuffMasterAdapter(
      orgatex.dyestuffMasterReader,
      recipesWorkingCopy,
    ),
    identities: new SqliteMaterialIdentityRepository(
      openMaterialDatabase(':memory:', identity.db),
      clock.now,
    ),
    lots: new SqliteMaterialLotRepository(
      openMaterialDatabase(':memory:', identity.db),
      clock.now,
    ),
    containers: containerMaster,
    scaleTare: new ScaleTareAdapter(scales.registry, scales.adapters),
    assignments: new SqliteContainerAssignmentRepository(
      openContainerDatabase(':memory:', identity.db),
      clock.now,
    ),
    clock: clock.now,
  });

  // The weighing session (unit 003). The rule is UNIT 004's — bound here,
  // in the one place the two units meet — and the threshold stays unit
  // 004's configuration (ADR-019).
  //
  // The session is the station's LIVE state, and it is persisted so the
  // work can be resumed (NFR-06, ADR-036).
  //
  // It is built AFTER unit 002's module, because it reads the recipe
  // through unit 002's working copy.
  const station = buildWeighingStationModule({
    workingCopy: recipes.workingCopy,
    selection: new ScaleSelectionAdapter(scales.registry),
    sessions: new SqliteWeighingSessionRepository(
      openSessionDatabase(':memory:', identity.db),
      clock.now,
    ),
    records: new SqliteWeighingRecordRepository(
      openRecordDatabase(':memory:', identity.db),
      clock.now,
    ),
    proposals: new SqliteSurplusProposalRepository(
      openProposalDatabase(':memory:', identity.db),
      clock.now,
    ),
    // UNIT 008's authorisation service — bound DIRECTLY (ADR-039).
    authorisations: identity.authorisation,
    overrides: new SqliteOverrideRecordRepository(
      openOverrideDatabase(':memory:', identity.db),
      clock.now,
    ),
    stream: new ScaleStreamAdapter(scales.streams, scales.registry, scales.adapters),
    // UNIT 005's write path — through a shim that adds no guard (ADR-041).
    writeBack: new OrgatexWriteBackAdapter(
      orgatex.postingService,
      orgatex.statusWriteService,
      orgatex.syncQueueService,
    ),
    batchFacts: new OrgatexBatchFactsAdapter(orgatex.queueReader),
    clock: clock.now,
  });

  // The ticket printing (unit 006). Its ticket is a READ MODEL over the
  // session's confirmed records.
  //
  // AND THE PRINTER IS THE MODULE'S OWN — so a test that makes it fail is
  // affecting the printer the product actually uses, and can prove that
  // the weighing is unaffected (B-7).
  const tickets = buildTicketModule({
    sessions: {
      current: async () => {
        const session = await station.sessions.current();
        if (session === null) return null;
        return {
          sessionId: session.sessionId,
          batchId: session.batchId,
          state: session.state,
          operatorId: session.operatorId,
          completedCount: session.completedCount,
          componentCount: session.componentCount,
        };
      },
    },
    records: {
      confirmedFor: (sessionId) => station.records.allFor(sessionId),
    },
    batchIdentity: new OrgatexBatchIdentityAdapter(orgatex.queueReader),
    configuration: new DefaultTicketConfiguration(),
    databasePath: ':memory:',
    db: identity.db,
    localeDirectory: writeLocaleBundles(
      join(tmpdir(), 'weighingms-locales-' + randomUUID()),
    ),
    defaultLocale: 'en',
    scopeExists: (scope) => scope === 'SCOPE-EXISTS',
    // THE REPORT'S READS — all READS, and the report writes nothing
    // (ADR-046).
    reportRecords: {
      between: (from, to) => station.records.between(from, to),
    },
    reportAudit: {
      filter: (filter) => tickets.audit.filter(filter),
    },
    reportProgress: {
      progressFor: async () => [],
    },
    shifts: [
      { name: 'DAY', startHour: 6, endHour: 14 },
      { name: 'NIGHT', startHour: 14, endHour: 22 },
    ],
    clock: clock.now,
  });

  const app = createApp({
    identity,
    scales,
    orgatex,
    batches,
    recipes,
    station,
    tickets,
  });

  return {
    identity,
    scales,
    orgatex,
    batches,
    recipes,
    recipeWorkingCopy: recipesWorkingCopy,
    station,
    tickets,
    scanner,
    app,
    clock,
    close: () => {
      // The OrgaTEX unit's timers must be released BEFORE the database
      // is closed. A freshness deadline that fires after the database is
      // gone reads a closed database — and its rejection would surface
      // as an unhandled rejection in whichever test happened to be
      // running.
      orgatex.linkScheduler.dispose();
      orgatex.syncRetryWorker.dispose();
      scales.close();
      identity.close();
    },
  };
}

/** Create an operator with a credential, in the given harness. */
export async function seedOperator(
  harness: Harness,
  id: string,
  displayName: string,
  role: 'OPERATOR' | 'SUPERVISOR',
  secret: string,
): Promise<void> {
  const operatorId = OperatorId.create(id);
  const operator = new Operator(
    operatorId,
    displayName,
    role === 'SUPERVISOR' ? OperatorRole.supervisor() : OperatorRole.operator(),
    true,
    harness.clock.now(),
  );
  await harness.identity.operatorRepository.save(operator);
  await harness.identity.credentials.create(
    operatorId,
    operator.role,
    secret,
  );
}

/** Deactivate an operator without touching their credential. */
export async function deactivateOperator(
  harness: Harness,
  id: string,
): Promise<void> {
  const operator = await harness.identity.operatorRepository.findById(
    OperatorId.create(id),
  );
  if (operator === null) throw new Error(`No such operator: ${id}`);
  await harness.identity.operatorRepository.save(operator.deactivate());
}
