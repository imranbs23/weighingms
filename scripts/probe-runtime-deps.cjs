/**
 * Probe what is available for the technical design of bolt 001.
 *
 * The design must not assume a dependency the environment cannot supply.
 * This checks the runtime pieces the identity unit needs: SQLite, the HTTP
 * framework, the validation library, the test runner, and the hashing
 * libraries the tech stack mentions.
 */
const results = {};

function probe(name, fn) {
  try {
    results[name] = fn();
  } catch (e) {
    results[name] = { available: false, error: e.message };
  }
}

probe('better-sqlite3', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 'b');
  const row = db.prepare('SELECT v FROM t WHERE id = ?').get('a');
  db.close();
  return { available: true, sample: row };
});

probe('express', () => {
  const express = require('express');
  const app = express();
  return { available: true, version: require('express/package.json').version, isFn: typeof express === 'function' };
});

probe('zod', () => {
  const { z } = require('zod');
  const s = z.object({ a: z.string().min(1) });
  return { available: true, version: require('zod/package.json').version, parse: s.parse({ a: 'x' }) };
});

probe('vitest', () => {
  return { available: true, version: require('vitest/package.json').version };
});

probe('supertest', () => {
  return { available: true, version: require('supertest/package.json').version };
});

probe('decimal.js', () => {
  const Decimal = require('decimal.js');
  return { available: true, version: require('decimal.js/package.json').version, sum: new Decimal('0.1').plus('0.2').toString() };
});

probe('argon2 (npm pkg)', () => {
  const argon2 = require('argon2');
  return { available: true, version: require('argon2/package.json').version };
});

probe('bcrypt', () => {
  return { available: true, version: require('bcrypt/package.json').version };
});

probe('typescript', () => {
  return { available: true, version: require('typescript/package.json').version };
});

probe('react', () => {
  return { available: true, version: require('react/package.json').version };
});

probe('vite', () => {
  return { available: true, version: require('vite/package.json').version };
});

probe('zustand', () => {
  return { available: true, version: require('zustand/package.json').version };
});

for (const [k, v] of Object.entries(results)) {
  const ok = v && v.available;
  console.log(`${ok ? 'YES' : ' no'}  ${k.padEnd(22)} ${JSON.stringify(v)}`);
}
