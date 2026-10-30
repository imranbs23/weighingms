/**
 * Unquote ISO timestamps in memory-bank frontmatter.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The specs.md framework scripts rewrite frontmatter with `js-yaml`'s
 * `dump`, which QUOTES a string that looks like a date:
 *
 *     created: '2026-10-30T09:00:00Z'
 *
 * The project's own convention — enforced by `verify-frontmatter.cjs` —
 * is an UNQUOTED ISO 8601 timestamp:
 *
 *     created: 2026-10-30T09:00:00Z
 *
 * So every bolt completion silently reintroduces the violation, and the
 * next verifier run reports it as a problem in a file nobody touched by
 * hand.
 *
 * The fix is applied to the files the framework wrote, then every
 * timestamp in the memory bank is re-checked. A quoted timestamp that
 * remains is reported, and the script exits non-zero.
 */
const fs = require('node:fs');
const path = require('node:path');

/** The project's convention: an unquoted ISO 8601 timestamp. */
const QUOTED = /'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)'/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = walk('memory-bank');
const changed = [];

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  if (!QUOTED.test(original)) continue; // `test` advances lastIndex; reset below
  QUOTED.lastIndex = 0;

  const updated = original.replace(QUOTED, '$1');
  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');
    changed.push(file);
  }
  QUOTED.lastIndex = 0;
}

console.log(`files inspected : ${files.length}`);
console.log(`files changed   : ${changed.length}`);
if (changed.length) {
  console.log('\n--- unquoted ---');
  for (const f of changed) console.log('  ' + f);
}

// ── Verify ──
const remaining = [];
for (const file of walk('memory-bank')) {
  const content = fs.readFileSync(file, 'utf8');
  const m = content.match(/'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)'/g);
  if (m) remaining.push(`${file}  (${m.length})`);
}

if (remaining.length) {
  console.log('\n--- STILL QUOTED ---');
  for (const r of remaining) console.log('  ' + r);
  process.exit(1);
}

console.log('\n✅ Every timestamp in the memory bank is unquoted.');
