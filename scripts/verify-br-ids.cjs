/**
 * Verify that every BRD identifier cited in the story files actually exists
 * in docs/brief.md.
 *
 * The BRD is the source of truth for FR-nn, BR-nn, IR-nn, NFR-nn, AC-nn and
 * DR-nn. A story that cites "BRD IR-19" when the BRD stops at IR-18 is
 * citing a requirement that does not exist — a traceability defect that no
 * amount of convention-hygiene checking would catch.
 *
 * Valid ranges, read from docs/brief.md:
 *   FR-01 .. FR-37
 *   NFR-01 .. NFR-16
 *   IR-01 .. IR-18
 *   AC-01 .. AC-16
 *   DR-01 .. DR-04
 *   BR-01 .. BR-30   (the BRD business-rule register)
 *
 * Usage: node scripts/verify-br-ids.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = path.join(ROOT, 'memory-bank/intents/001-assisted-dyestuff-weighing-station');

// ── Ranges, derived from the BRD itself rather than hard-coded ───────────
function deriveRanges() {
  const brd = fs.readFileSync(path.join(ROOT, 'docs/brief.md'), 'utf8');
  const ranges = {};

  for (const kind of ['FR', 'BR', 'IR', 'NFR', 'AC', 'DR']) {
    const nums = new Set();
    // A definition line looks like "FR-13 Display live weight ..." at the
    // start of a line.
    const re = new RegExp('^' + kind + '-(\\d{1,2})\\s+\\S', 'gm');
    let m;
    while ((m = re.exec(brd)) !== null) nums.add(Number(m[1]));
    if (nums.size) ranges[kind] = nums;
  }
  return ranges;
}

const RANGES = deriveRanges();

console.log('BRD identifier ranges derived from docs/brief.md:');
for (const [k, v] of Object.entries(RANGES)) {
  const nums = [...v].sort((a, b) => a - b);
  console.log(`  ${k}: ${nums[0]}..${nums[nums.length - 1]}  (${nums.length} defined)`);
}
console.log('');

// ── Scan the stories ─────────────────────────────────────────────────────
const stories = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.md') && /[\\/]stories[\\/]/.test(p)) stories.push(p);
  }
})(INTENT);

const problems = [];

for (const f of stories) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // Only BRD-prefixed identifiers are checked against the BRD.
    const re = /\bBRD\s+(FR|BR|IR|NFR|AC|DR)-(\d{1,2})\b/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const kind = m[1];
      const n = Number(m[2]);
      const defined = RANGES[kind];
      if (!defined) {
        problems.push(`${rel}:${i + 1}  BRD ${kind}-${n} — "${kind}" is not a BRD identifier kind`);
      } else if (!defined.has(n)) {
        const nums = [...defined].sort((a, b) => a - b);
        problems.push(
          `${rel}:${i + 1}  BRD ${kind}-${n} does not exist in the BRD ` +
            `(defined: ${kind}-${nums[0]}..${kind}-${nums[nums.length - 1]})`
        );
      }
    }
  });
}

console.log(`checked ${stories.length} story files`);

if (problems.length === 0) {
  console.log('\n✅ Every BRD identifier cited exists in docs/brief.md.');
  process.exit(0);
}

console.log(`\n❌ ${problems.length} problem(s):\n`);
const seen = new Set();
for (const p of problems) {
  if (seen.has(p)) continue;
  seen.add(p);
  console.log('  ' + p);
}
process.exit(1);
