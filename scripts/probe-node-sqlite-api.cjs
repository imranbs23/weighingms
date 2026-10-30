/**
 * Probe the node:sqlite API surface this project depends on.
 *
 * `better-sqlite3` (the tech stack's original choice) cannot be installed
 * here — it needs a Visual Studio C++ toolchain that is not installed. Node
 * 22+ ships `node:sqlite` instead, which needs no build step.
 *
 * This checks the specific behaviours the repositories rely on, so the
 * adapter is written against what the driver ACTUALLY does rather than
 * what the better-sqlite3 documentation says:
 *   - DatabaseSync: exec, prepare, close
 *   - statement.run / get / all
 *   - named vs positional parameters
 *   - transactions
 *   - WAL mode
 *   - how UNIQUE / CHECK constraints report violations
 *   - whether a boolean can be bound
 */
const { DatabaseSync } = require('node:sqlite');

console.log('node', process.version);

const db = new DatabaseSync(':memory:');

// WAL is not applicable to :memory:, but check it does not throw.
try {
  db.exec('PRAGMA journal_mode = WAL');
  console.log('WAL pragma on :memory: ok');
} catch (e) {
  console.log('WAL pragma on :memory: threw:', e.message);
}

db.exec(`
  CREATE TABLE operators (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )
`);

const ins = db.prepare(
  'INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)'
);
ins.run('op-1', 'R. Karim', 'OPERATOR', 1, '2026-10-30T00:00:00.000Z');

// named parameters
const named = db.prepare('SELECT * FROM operators WHERE id = :id');
console.log('named param get:', named.get({ id: 'op-1' }));

// all()
db.prepare('INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)').run(
  'op-2', 'S. Ahmed', 'SUPERVISOR', 1, '2026-10-30T00:00:00.000Z'
);
console.log('all():', db.prepare('SELECT id FROM operators ORDER BY id').all());

// boolean binding — better-sqlite3 rejects booleans, node:sqlite may too
try {
  db.prepare('INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'op-3', 'X', 'OPERATOR', true, '2026-10-30T00:00:00.000Z'
  );
  console.log('boolean bind: ACCEPTED');
} catch (e) {
  console.log('boolean bind: REJECTED —', e.message);
}

// CHECK constraint violation
try {
  db.prepare('INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'op-4', 'Y', 'ADMIN', 1, '2026-10-30T00:00:00.000Z'
  );
  console.log('CHECK violation: NOT ENFORCED');
} catch (e) {
  console.log('CHECK violation enforced:', e.message);
}

// UNIQUE violation
try {
  db.prepare('INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'op-1', 'Dup', 'OPERATOR', 1, '2026-10-30T00:00:00.000Z'
  );
  console.log('UNIQUE violation: NOT ENFORCED');
} catch (e) {
  console.log('UNIQUE violation enforced:', e.message);
}

// transactions
try {
  db.exec('BEGIN');
  db.prepare('INSERT INTO operators (id, display_name, role, active, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'op-5', 'T', 'OPERATOR', 1, '2026-10-30T00:00:00.000Z'
  );
  db.exec('ROLLBACK');
  const row = db.prepare('SELECT id FROM operators WHERE id = ?').get('op-5');
  console.log('transaction rollback:', row === undefined ? 'worked (row absent)' : 'FAILED (row present)');
} catch (e) {
  console.log('transaction threw:', e.message);
}

// undefined binding
try {
  db.prepare('SELECT * FROM operators WHERE id = ?').get(undefined);
  console.log('undefined bind: accepted');
} catch (e) {
  console.log('undefined bind: rejected —', e.message);
}

db.close();
console.log('closed ok');
