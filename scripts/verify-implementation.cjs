/**
 * Smoke-test the identity unit against a real running server.
 *
 * This is NOT the test suite — Stage 5 owns that. This is the
 * implementation-stage check that the thing actually WORKS: the server
 * starts, the API answers, the credentials are hashed at rest, and the
 * security properties hold.
 *
 * Run: node scripts/verify-implementation.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Resolve the tsx CLI directly rather than shelling out to `npx` or the
 * `.bin/tsx.cmd` shim.
 *
 * `npx` is not on the PATH of a spawned process on this machine (ENOENT),
 * and the `.cmd` shim is a batch file, not JavaScript — passing it to
 * `node` produces a syntax error. The real entrypoint is tsx's
 * `dist/cli.mjs`, which node can run directly.
 */
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runNode(args, env) {
  return spawn(process.execPath, [TSX_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  // Use a fresh database so the check is hermetic.
  const dbPath = path.join(ROOT, 'data', 'verify-impl.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${dbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const server = runNode(['scripts/seed-identity.ts'], {
    WEIGHINGMS_DB_PATH: dbPath,
  });
  await new Promise((r) => setTimeout(r, 5000));

  const api = runNode(['src/api/server.ts'], {
    WEIGHINGMS_DB_PATH: dbPath,
    PORT: String(PORT),
  });
  api.stderr.on('data', (d) => {
    const s = String(d);
    if (s.includes('Error') || s.includes('error')) console.log('  [server stderr]', s.trim());
  });

  try {
    if (!(await waitForServer())) {
      fail('server did not start');
      return;
    }
    ok('server started');

    // ── 1. Sign in with a valid credential ──
    const signIn = await fetch(`${BASE}/api/identity/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: 'OP-001', secret: '4821' }),
    });
    const signInBody = await signIn.json();
    if (signIn.status !== 200) fail(`sign-in returned ${signIn.status}: ${JSON.stringify(signInBody)}`);
    else ok(`sign-in returned 200 (${signInBody.operator.displayName}, role ${signInBody.operator.role})`);

    const token = signInBody.token;
    if (typeof token !== 'string' || token.length < 40) {
      fail(`token looks wrong: ${String(token).slice(0, 20)}...`);
    } else {
      ok(`token is ${token.length} chars, opaque (no operator id embedded: ${!token.includes('OP-001')})`);
    }

    // ── 2. The token must not decode to the operator ──
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      fail(`token decoded to JSON: ${JSON.stringify(decoded)}`);
    } catch {
      ok('token is not decodable to JSON (opaque)');
    }

    // ── 3. Current operator works with the token ──
    const current = await fetch(`${BASE}/api/identity/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const currentBody = await current.json();
    if (current.status !== 200) fail(`current returned ${current.status}`);
    else ok(`current returned ${currentBody.operator.operatorId} / ${currentBody.operator.role}`);

    // ── 4. Wrong secret and unknown operator are IDENTICAL ──
    const wrongSecret = await fetch(`${BASE}/api/identity/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: 'OP-001', secret: '0000' }),
    });
    const wrongBody = await wrongSecret.text();

    const unknownOperator = await fetch(`${BASE}/api/identity/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: 'NOPE-999', secret: '4821' }),
    });
    const unknownBody = await unknownOperator.text();

    if (wrongSecret.status !== unknownOperator.status) {
      fail(`statuses differ: wrong=${wrongSecret.status} unknown=${unknownOperator.status}`);
    } else {
      ok(`both failures return ${wrongSecret.status}`);
    }
    if (wrongBody !== unknownBody) {
      fail(`bodies differ:\n    wrong:   ${wrongBody}\n    unknown: ${unknownBody}`);
    } else {
      ok(`both failure bodies are byte-identical: ${wrongBody}`);
    }

    // ── 5. Role is from the credential, not the request ──
    const escalate = await fetch(`${BASE}/api/identity/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: 'OP-001', secret: '4821', role: 'SUPERVISOR' }),
    });
    const escalateBody = await escalate.json();
    if (escalateBody.operator?.role === 'SUPERVISOR') {
      fail('client-supplied role was accepted!');
    } else {
      ok(`client-supplied role ignored — role is ${escalateBody.operator?.role}`);
    }

    // ── 6. No token → 401; tampered token → 401 (same body) ──
    const noToken = await fetch(`${BASE}/api/identity/current`);
    const noTokenBody = await noToken.text();
    const tampered = await fetch(`${BASE}/api/identity/current`, {
      headers: { Authorization: `Bearer ${token.slice(0, -4)}XXXX` },
    });
    const tamperedBody = await tampered.text();
    if (noToken.status !== 401 || tampered.status !== 401) {
      fail(`expected 401s, got ${noToken.status} and ${tampered.status}`);
    } else {
      ok('no token and tampered token both return 401');
    }
    if (noTokenBody !== tamperedBody) {
      fail(`401 bodies differ:\n    none:     ${noTokenBody}\n    tampered: ${tamperedBody}`);
    } else {
      ok(`401 bodies are identical: ${noTokenBody}`);
    }

    // ── 7. Sign out ends the session ──
    const signOut = await fetch(`${BASE}/api/identity/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (signOut.status !== 200) fail(`sign-out returned ${signOut.status}`);
    else ok('sign-out returned 200');

    const afterSignOut = await fetch(`${BASE}/api/identity/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (afterSignOut.status !== 401) {
      fail(`session still live after sign-out (${afterSignOut.status})`);
    } else {
      ok('session authorises nothing after sign-out');
    }

    // ── 8. Sign out is idempotent ──
    const signOutAgain = await fetch(`${BASE}/api/identity/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (signOutAgain.status !== 200) {
      fail(`second sign-out returned ${signOutAgain.status}, expected 200 (idempotent)`);
    } else {
      ok('sign-out is idempotent');
    }

    // ── 9. The credential is hashed at rest ──
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const creds = db.prepare('SELECT operator_id, secret_hash FROM credentials').all();
    db.close();
    let plaintextLeak = false;
    for (const c of creds) {
      const h = c.secret_hash;
      if (!h.startsWith('$argon2id$')) {
        fail(`hash is not in argon2id format: ${String(h).slice(0, 30)}`);
        plaintextLeak = true;
      }
      if (h.includes('4821') || h.includes('9164') || h.includes('7359')) {
        fail('PLAINTEXT PIN FOUND IN THE CREDENTIAL STORE');
        plaintextLeak = true;
      }
    }
    if (!plaintextLeak) {
      ok(`all ${creds.length} credential(s) stored as argon2id hashes, no plaintext`);
    }

    // ── 10. The session token is stored hashed, not raw ──
    const db2 = new DatabaseSync(dbPath);
    const sessions = db2
      .prepare('SELECT token_hash FROM identity_sessions')
      .all();
    db2.close();
    let rawLeak = false;
    for (const s of sessions) {
      const h = String(s.token_hash);
      if (h.length !== 64 || !/^[0-9a-f]{64}$/.test(h)) {
        fail(`token_hash is not a sha256 hex digest: ${h.slice(0, 24)}`);
        rawLeak = true;
      }
      if (h === token) {
        fail('RAW TOKEN FOUND IN THE SESSION TABLE');
        rawLeak = true;
      }
    }
    if (!rawLeak) {
      ok(`all ${sessions.length} session row(s) store a sha256 digest, not the raw token`);
    }
  } finally {
    api.kill();
    server.kill();
  }
}

main().catch((e) => {
  console.error('verification crashed:', e);
  process.exitCode = 1;
});
