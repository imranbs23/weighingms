/**
 * The API server entry point.
 *
 * Separate process on port 3000, per the tech stack's service topology:
 *
 *   React SPA (Vite)  ──XHR / EventSource──>  Express API
 *      :5173                                    :3000
 */
import { createApp } from './app.js';
import {
  buildIdentityModule,
} from '../008-operator-identity/infrastructure/composition-root.js';
import { loadIdentityConfig } from '../008-operator-identity/infrastructure/config/identity-config.js';
import { OperatorId } from '../008-operator-identity/domain/value-objects/operator-id.js';
import { buildScaleModule } from '../004-scale-integration/infrastructure/composition-root.js';
import { loadScaleConfig } from '../004-scale-integration/infrastructure/config/scale-config.js';
import { buildOrgatexModule } from '../005-orgatex-integration/infrastructure/composition-root.js';
import { loadOrgatexConfig } from '../005-orgatex-integration/infrastructure/config/orgatex-config.js';
import {
  buildBatchManagementModule,
} from '../001-batch-management/infrastructure/composition-root.js';
import {
  openBatchManagementDatabase,
} from '../001-batch-management/infrastructure/persistence/batch-selection-database.js';
import {
  SqliteBatchSelectionRepository,
} from '../001-batch-management/infrastructure/persistence/sqlite-batch-selection-repository.js';
import {
  DummyBatchScanner,
} from '../001-batch-management/infrastructure/adapters/dummy-batch-scanner.js';
import {
  buildRecipeMaterialModule,
} from '../002-recipe-material-management/infrastructure/composition-root.js';
import {
  RecipeWorkingCopy,
} from '../002-recipe-material-management/domain/services/recipe-working-copy.js';
import {
  OrgatexDyestuffMasterAdapter,
} from '../002-recipe-material-management/infrastructure/adapters/orgatex-dyestuff-master-adapter.js';
import {
  openMaterialDatabase,
} from '../002-recipe-material-management/infrastructure/persistence/material-database.js';
import {
  SqliteMaterialIdentityRepository,
} from '../002-recipe-material-management/infrastructure/persistence/sqlite-material-identity-repository.js';
import {
  SqliteMaterialLotRepository,
} from '../002-recipe-material-management/infrastructure/persistence/sqlite-material-lot-repository.js';
import {
  openContainerDatabase,
} from '../002-recipe-material-management/infrastructure/persistence/container-database.js';
import {
  SqliteContainerAssignmentRepository,
} from '../002-recipe-material-management/infrastructure/persistence/sqlite-container-assignment-repository.js';
import {
  SqliteContainerMasterRepository,
} from '../002-recipe-material-management/infrastructure/persistence/sqlite-container-master-repository.js';
import {
  ScaleTareAdapter,
} from '../002-recipe-material-management/infrastructure/adapters/scale-tare-adapter.js';
import {
  buildWeighingStationModule,
} from '../003-weighing-station/infrastructure/composition-root.js';
import {
  ScaleSelectionAdapter,
} from '../003-weighing-station/infrastructure/adapters/scale-selection-adapter.js';
import {
  openSessionDatabase,
} from '../003-weighing-station/infrastructure/persistence/session-database.js';
import {
  SqliteWeighingSessionRepository,
} from '../003-weighing-station/infrastructure/persistence/sqlite-weighing-session-repository.js';
import {
  openRecordDatabase,
} from '../003-weighing-station/infrastructure/persistence/record-database.js';
import {
  SqliteWeighingRecordRepository,
} from '../003-weighing-station/infrastructure/persistence/sqlite-weighing-record-repository.js';
import {
  openProposalDatabase,
} from '../003-weighing-station/infrastructure/persistence/proposal-database.js';
import {
  SqliteSurplusProposalRepository,
} from '../003-weighing-station/infrastructure/persistence/sqlite-surplus-proposal-repository.js';
import {
  openOverrideDatabase,
} from '../003-weighing-station/infrastructure/persistence/override-database.js';
import {
  SqliteOverrideRecordRepository,
} from '../003-weighing-station/infrastructure/persistence/sqlite-override-record-repository.js';
import {
  ScaleStreamAdapter,
} from '../003-weighing-station/infrastructure/adapters/scale-stream-adapter.js';
import {
  OrgatexWriteBackAdapter,
  OrgatexBatchFactsAdapter,
} from '../003-weighing-station/infrastructure/adapters/orgatex-write-back-adapter.js';
import {
  buildTicketModule,
} from '../006-ticket-printing/infrastructure/composition-root.js';
import {
  OrgatexBatchIdentityAdapter,
  DefaultTicketConfiguration,
} from '../006-ticket-printing/infrastructure/adapters/batch-identity-adapter.js';
import {
  loadTicketConfig,
} from '../006-ticket-printing/infrastructure/config/ticket-config.js';
import { ContainerId } from '../002-recipe-material-management/domain/value-objects/container-id.js';

const PORT = Number(process.env['PORT'] ?? 3000);

// The ticket unit's configuration — where the locale bundles live.
const ticketConfig = loadTicketConfig();

const config = loadIdentityConfig();
const identity = buildIdentityModule({ config });

// The scale unit shares the identity unit's database file, so both
// units' migrations live in one `schema_migrations` table.
const scaleConfig = loadScaleConfig({ ...process.env, WEIGHINGMS_DATABASE_PATH: config.databasePath });
const scales = buildScaleModule({ config: scaleConfig, db: identity.db });

// The OrgaTEX unit's READ path persists nothing (ADR-021), but its WRITE
// path does — the postings, the ledger and the attempts — so it shares
// the identity unit's database file and its migration table.
const orgatexConfig = loadOrgatexConfig({
  ...process.env,
  WEIGHINGMS_DATABASE_PATH: config.databasePath,
});
const orgatex = buildOrgatexModule({
  config: orgatexConfig,
  db: identity.db,
  // THE RETRY WORKER RUNS IN THE SERVER. A write queued while OrgaTEX was
  // unreachable is re-driven from the durable queue once it is back; without
  // the worker it would stay PENDING forever (found by workbook Step 30).
  startRetryWorker: true,
});

// The station's own batch queue (unit 001). It reads the MES ONLY through
// unit 005's reader — bound here, in the one place the two units meet
// (ADR-028). There is no second reader of the seam and no second cache.
//
// The selection IS persisted, unlike the queue: a selection cannot be
// re-derived — the MES has no idea the operator chose a batch — and it is
// a traceability record (ADR-029). It shares the identity unit's database
// file and its migration table, so all four units can share one file.
// THE SCANNER IS ONE DEVICE, AND IT IS SHARED.
//
// One physical barcode scanner serves the batch card, the dyestuff code and
// the lot code. Unit 001 reads it through its own port, unit 002 through
// its own — and both ports are bound to **this instance**, so there is one
// device state and one training artefact behind `POST /api/scan` (ADR-033).
const scanner = new DummyBatchScanner();

const batches = buildBatchManagementModule({
  source: orgatex.queueReader,
  scanner,
  selections: new SqliteBatchSelectionRepository(
    openBatchManagementDatabase(config.databasePath, identity.db),
  ),
  onError: (detail) => console.error(detail),
});

// The station's recipe and materials (unit 002). The recipe reads the MES
// ONLY through unit 005's recipe reader — bound here, in the one place the
// two units meet (ADR-032). There is no second reader of the seam and no
// second cache.
//
// The scanner is the SAME instance unit 001 uses — one physical device,
// one state, one training artefact behind `POST /api/scan` (ADR-033).
//
// The recipe persists NOTHING (ADR-031): it is the MES's truth. The
// identity and the lot capture DO persist (ADR-034): they are the
// station's own acts, and the MES has no idea they happened.
const recipesWorkingCopy = new RecipeWorkingCopy();

// The container master — WeighingMS's own reference data (BRD §9.3).
const containerMaster = new SqliteContainerMasterRepository(
  openContainerDatabase(config.databasePath, identity.db),
);

const recipes = buildRecipeMaterialModule({
  source: orgatex.recipeReader,
  scanner,
  workingCopy: recipesWorkingCopy,
  master: new OrgatexDyestuffMasterAdapter(
    orgatex.dyestuffMasterReader,
    recipesWorkingCopy,
  ),
  identities: new SqliteMaterialIdentityRepository(
    openMaterialDatabase(config.databasePath, identity.db),
  ),
  lots: new SqliteMaterialLotRepository(
    openMaterialDatabase(config.databasePath, identity.db),
  ),
  containers: containerMaster,
  scaleTare: new ScaleTareAdapter(scales.registry, scales.adapters),
  assignments: new SqliteContainerAssignmentRepository(
    openContainerDatabase(config.databasePath, identity.db),
  ),
  onError: (detail) => console.error(detail),
});

// The container master is WeighingMS's OWN data (BRD §9.3), so it is
// seeded rather than read from the MES.
containerMaster.seedSync();

// The weighing session (unit 003). The rule is UNIT 004's — bound here, in
// the one place the two units meet — and the threshold stays unit 004's
// configuration (ADR-019). The session is the station's LIVE state, and it
// is persisted so the work can be resumed (NFR-06, ADR-036).
const station = buildWeighingStationModule({
  workingCopy: recipesWorkingCopy,
  // UNIT 002's captures — read, so the record carries this session's lot
  // and container (bolt 031).
  lots: recipes.lots,
  assignments: recipes.assignments,
  sourceLot: (componentId, operatorId) =>
    recipes.captureMaterialLot.captureFromSource(componentId, OperatorId.create(operatorId)),
  selection: new ScaleSelectionAdapter(scales.registry),
  sessions: new SqliteWeighingSessionRepository(
    openSessionDatabase(config.databasePath, identity.db),
  ),
  records: new SqliteWeighingRecordRepository(
    openRecordDatabase(config.databasePath, identity.db),
  ),
  proposals: new SqliteSurplusProposalRepository(
    openProposalDatabase(config.databasePath, identity.db),
  ),
  // UNIT 008's authorisation service — bound DIRECTLY, with no adapter
  // and no second implementation of any check (ADR-039). Its
  // `PrivilegedAction` already names `CONFIRM_COMPONENT` for this story.
  authorisations: identity.authorisation,
  overrides: new SqliteOverrideRecordRepository(
    openOverrideDatabase(config.databasePath, identity.db),
  ),
  // THE STREAM — the session subscribes to the device it is bound to, so
  // the weight is pushed rather than polled (NFR-01).
  stream: new ScaleStreamAdapter(scales.streams, scales.registry, scales.adapters),
  // UNIT 005's write path — bound through a shim that adds NO guard, so
  // unit 005's idempotency ledger stays the atomic duplicate guard
  // (ADR-041).
  writeBack: new OrgatexWriteBackAdapter(
    orgatex.postingService,
    orgatex.statusWriteService,
    orgatex.syncQueueService,
  ),
  batchFacts: new OrgatexBatchFactsAdapter(orgatex.queueReader),
  onError: (detail) => console.error(detail),
});

// The ticket printing (unit 006). Its ticket is a READ MODEL over the
// session's confirmed records — and the PRINT PATH HAS NO WEIGHING-RECORD
// REPOSITORY, so a printer failure cannot cost a weighing (B-7, ADR-042).
const ticketModule = buildTicketModule({
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
  databasePath: config.databasePath,
  db: identity.db,
  // THE LOCALE BUNDLES. They are FILES, read at runtime — so a language
  // is changeable without a redeployment (BRD NFR-11, NFR-14).
  localeDirectory: ticketConfig.localeDirectory,
  defaultLocale: ticketConfig.defaultLocale,
  // Whether a scope exists — an override applied to a scope that does not
  // exist is REFUSED, and no version is bumped (ADR-045).
  scopeExists: (scope) => scopeExists(scope),
  // THE REPORT'S READS. The records' period-scoped read, the trail's, and
  // the station's own batch progress — all READS, and the report writes
  // nothing (ADR-046).
  reportRecords: {
    between: (from, to) => station.records.between(from, to),
  },
  reportAudit: {
    filter: (filter) => reportAuditFilter(filter),
  },
  reportProgress: {
    progressFor: async (period) => batchProgressFor(period),
  },
  shifts: [
    { name: 'DAY', startHour: 6, endHour: 14 },
    { name: 'NIGHT', startHour: 14, endHour: 22 },
  ],
  onError: (detail) => console.error(detail),
});

/**
 * Whether a scope exists.
 *
 * **The station's own check** — a scope is a container in WeighingMS's own
 * reference data, so the station knows which scopes exist. An override
 * applied to a scope that does not exist is REFUSED, and **no version is
 * bumped** (ADR-045).
 */
async function scopeExists(scope: string): Promise<boolean> {
  const container = await containerMaster.read(
    ContainerId.create(scope),
  );
  return container.kind === 'FOUND';
}

/**
 * The trail's period-scoped read — the report's second read.
 *
 * **A READ.** And the report's use case never calls `record` — so the
 * report cannot write (ADR-046).
 */
async function harnessAuditFilter(filter: {
  from?: Date | null;
  to?: Date | null;
  action?: string | null;
}) {
  return ticketModule.audit.filter(filter);
}

/**
 * The trail's period-scoped read — the report's second read.
 *
 * **A READ.** And the report's use case never calls `record` — so the
 * report cannot write (ADR-046).
 */
async function reportAuditFilter(filter: {
  from?: Date | null;
  to?: Date | null;
  action?: string | null;
}) {
  return ticketModule.audit.filter(filter);
}

/**
 * The station's own batch progress — the report's third read.
 *
 * **The station's batches**, not the MES's — where the station's batches
 * ARE is the report's subject (BRD BR-22).
 */
async function batchProgressFor(period: { from: Date; to: Date }) {
  const snapshot = await orgatex.queueReader.read();
  if (snapshot.kind === 'FAILED') return [];

  return snapshot.snapshot.batches.map((batch) => ({
    batchId: batch.batchId.value,
    weighed: 0,
    total: batch.componentCount,
    state: batch.weighingStatus,
  }));
}

const app = createApp({
  identity,
  scales,
  orgatex,
  batches,
  recipes,
  station,
  tickets: ticketModule,
  corsOrigins: readCorsOrigins(),
});

// THE DEVICES STREAM FROM BOOT — a connected, idle scale reads READY, as a
// real indicator would, rather than timing out to DISCONNECTED because no
// session happens to be listening. BEFORE the resume, so the resumed
// session subscribes to the pump that is already running.
scales.keepDevicesAlive();

// THE RESUME — and it happens BEFORE the server accepts a request.
//
// The session is persisted so the work can be resumed (NFR-06, ADR-036),
// but the subscription to its device lives in memory and died with the
// last process. **Without this the station would show a frozen weight
// forever** — the device speaks, and nobody hears it.
station.resume();

const server = app.listen(PORT, () => {
  console.log(`[api] WeighingMS API listening on http://localhost:${PORT}`);
  console.log(`[api] database: ${config.databasePath}`);
  console.log(
    `[api] identity provider: ${identity.provider.kind} — ${identity.provider.describe()}`,
  );
  console.log(
    `[api] session lifetime: ${Math.round(config.sessionLifetimeMs / 60000)} minutes`,
  );
  console.log(
    `[api] scales: ${scales.registry.list().length} registered — disconnect timeout ${scaleConfig.disconnectTimeoutMs}ms, sample interval ${scaleConfig.sampleIntervalMs}ms`,
  );
  console.log(
    `[api] OrgaTEX seam: source ${orgatexConfig.sourceName}, snapshot freshness window ${Math.round(orgatexConfig.freshnessWindowMs / 1000)}s`,
  );
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => {
    scales.close();
    identity.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * THE ALLOWED ORIGINS — and they are CONFIGURATION.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SPA'S ORIGIN IS NOT A CONSTANT. IT IS A DEPLOYMENT FACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The API's CORS allow-list is **the closed set of origins that may read
 * its responses** — and the session token is a bearer credential, so a
 * wildcard would hand it to any page the operator visits. That is why the
 * list is explicit.
 *
 * **But an explicit list is still a LIST, and the list belongs to the
 * deployment.** A development build serves the SPA on `:5173`; the e2e
 * harness serves it on its own port; a site deployment serves it from a
 * host. Hard-coding one of those into the composition root means the other
 * two cannot work — and the symptom is a browser console full of CORS
 * errors and a station that never signs in.
 *
 * So the list is read from the environment, comma-separated, and the
 * **default** is the development pair. `WEIGHINGMS_CORS_ORIGINS` replaces
 * it entirely — it does not extend it, because an allow-list that only
 * ever grows is not an allow-list.
 *
 * **And an entry is an ORIGIN, not a prefix** — `http://localhost:5173`
 * grants that exact origin and nothing else.
 */
function readCorsOrigins(): readonly string[] {
  const raw = process.env['WEIGHINGMS_CORS_ORIGINS'];
  if (raw === undefined || raw.trim() === '') {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
