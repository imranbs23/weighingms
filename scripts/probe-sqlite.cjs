/**
 * Probe for a SQLite driver that does NOT need a native build.
 *
 * Why
 * ---
 * `better-sqlite3` (the tech stack's choice) requires node-gyp and a Visual
 * Studio C++ toolchain on Windows. That toolchain is NOT installed in this
 * environment, so the install fails. The tech stack's promise that the
 * product is "self-contained and demonstrable offline" and "runs on
 * Windows/Linux/macOS" does not survive a dependency that needs a compiler
 * the user has to install first.
 *
 * Node 22+ ships `node:sqlite` as a built-in module. If it is available and
 * capable, the driver requirement disappears entirely — the same argument
 * that was made for using Node's built-in Argon2id instead of the `argon2`
 * npm package (ADR-001).
 *
 * This probe answers: is it there, and does it do what the design needs?
 */
const results = {};

function probeNodeSqlite() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT NOT NULL)');
    db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 'b');
    const row = db.prepare('SELECT v FROM t WHERE id = ?').get('a');
    db.exec('BEGIN');
    db.exec('COMMIT');
    db.close();
    return {
      available: true,
      hasDatabaseSync: true,
      row,
      supportsTransactions: true,
      node: process.version,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

function probeBetterSqlite3() {
  try {
    require('better-sqlite3');
    return { available: true };
  } catch (e) {
    return { available: false, error: e.message.split('\n')[0] };
  }
}

results['node:sqlite'] = probeNodeSqlite();
results['better-sqlite3'] = probeBetterSqlite3();

for (const [k, v] of Object.entries(results)) {
  console.log(`${v.available ? 'YES' : ' no'}  ${k}`);
  console.log(`        ${JSON.stringify(v)}`);
}
