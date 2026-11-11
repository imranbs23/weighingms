/**
 * The e2e API launcher.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SAME APPLICATION. A DIFFERENT PORT AND A DIFFERENT DATABASE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The e2e suite needs the **real** Express application — the same wiring,
 * the same adapters, the same SQLite — and it needs it **isolated**: its own
 * port, its own database file, and a database file that is deleted before
 * the run so every run starts from the same world.
 *
 * So this launcher is not a second application. It is the same
 * `src/api/server.ts`, started with the environment the harness sets:
 *
 *   PORT                    — the harness's own port
 *   WEIGHINGMS_DB_PATH      — the harness's own database file
 *
 * **And the operator directory is seeded** before the server accepts a
 * request, so the suite has an operator to sign in with. The seed is the
 * project's own `scripts/seed-identity.ts` — the real credential store, with
 * Argon2id hashing, not a stub.
 *
 * Usage:
 *   node scripts/e2e-api.mjs <port>
 */
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const port = Number(process.argv[2] ?? process.env['PORT'] ?? 3100);
const databasePath = resolve(
  root,
  process.env['WEIGHINGMS_DB_PATH'] ?? './data/e2e-weighingms.sqlite',
);

/**
 * The database is DELETED — so every run starts from the same world.
 *
 * Not "emptied", **deleted**: the schema is created by the migrations, and
 * a leftover row from a previous run would be a fact about a world that no
 * longer exists. The suite asserts on counts, so a clean file is the only
 * honest starting point.
 */
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

// THE SEED — the real operator directory, with Argon2id-hashed
// credentials. It runs to completion BEFORE the API starts, so the suite's
// first sign-in cannot race the seed.
await run('npx', ['tsx', 'scripts/seed-identity.ts'], {
  ...process.env,
  WEIGHINGMS_DB_PATH: databasePath,
});

await run('npx', ['tsx', 'src/api/server.ts'], {
  ...process.env,
  PORT: String(port),
  WEIGHINGMS_DB_PATH: databasePath,
});

/**
 * Run a command to completion, and fail loudly.
 *
 * The seed's exit code matters: a suite that signs in with no operator
 * would fail at the first step with a message that says nothing about the
 * seed.
 */
function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }
      rejectPromise(
        new Error(`${command} ${args.join(' ')} exited with code ${code}`),
      );
    });
  });
}
