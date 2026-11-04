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
import { buildScaleModule } from '../004-scale-integration/infrastructure/composition-root.js';
import { loadScaleConfig } from '../004-scale-integration/infrastructure/config/scale-config.js';
import { buildOrgatexModule } from '../005-orgatex-integration/infrastructure/composition-root.js';
import { loadOrgatexConfig } from '../005-orgatex-integration/infrastructure/config/orgatex-config.js';
import {
  buildBatchManagementModule,
} from '../001-batch-management/infrastructure/composition-root.js';

const PORT = Number(process.env['PORT'] ?? 3000);

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
});

// The station's own batch queue (unit 001). It reads the MES ONLY through
// unit 005's reader — bound here, in the one place the two units meet
// (ADR-028). There is no second reader of the seam and no second cache.
const batches = buildBatchManagementModule({
  source: orgatex.queueReader,
  onError: (detail) => console.error(detail),
});

const app = createApp({ identity, scales, orgatex, batches });

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
