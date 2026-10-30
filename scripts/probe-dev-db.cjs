/**
 * Probe the local development database's schema state.
 *
 * Run: node scripts/probe-dev-db.cjs
 *
 * Bolt 002's migrations (005–007) were never committed or released, so
 * migration 005 was edited in place to carry the new
 * `requested_operator_id` column. A database that already applied the OLD
 * 005 will therefore lack that column, and `CREATE TABLE IF NOT EXISTS`
 * will not add it. This probe reports which state a given database is in.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '..', 'data', 'weighingms.sqlite');

if (!fs.existsSync(dbPath)) {
  console.log('No development database at', dbPath);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);

const applied = db
  .prepare('SELECT id FROM schema_migrations ORDER BY id')
  .all()
  .map((r) => r.id);

console.log('database:', dbPath);
console.log('migrations applied:', applied.join(', ') || '(none)');

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%authorisation%'")
  .all()
  .map((r) => r.name);

if (tables.length === 0) {
  console.log('no authorisation tables yet — the database predates bolt 002');
  db.close();
  process.exit(0);
}

for (const table of tables) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  console.log(`${table}: ${cols.join(', ')}`);
}

const hasColumn = db
  .prepare('PRAGMA table_info(supervisor_authorisations)')
  .all()
  .some((c) => c.name === 'requested_operator_id');

console.log(
  hasColumn
    ? '\nOK — the schema matches the current migrations.'
    : '\nSTALE — this database applied the OLD migration 005 and lacks ' +
        '`requested_operator_id`. It must be rebuilt: delete the .sqlite, ' +
        '.sqlite-wal and .sqlite-shm files and restart the server.',
);

db.close();
