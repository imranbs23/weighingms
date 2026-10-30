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

const PORT = Number(process.env['PORT'] ?? 3000);

const config = loadIdentityConfig();
const identity = buildIdentityModule({ config });
const app = createApp({ identity });

const server = app.listen(PORT, () => {
  console.log(`[api] WeighingMS API listening on http://localhost:${PORT}`);
  console.log(`[api] database: ${config.databasePath}`);
  console.log(
    `[api] identity provider: ${identity.provider.kind} — ${identity.provider.describe()}`,
  );
  console.log(
    `[api] session lifetime: ${Math.round(config.sessionLifetimeMs / 60000)} minutes`,
  );
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => {
    identity.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
