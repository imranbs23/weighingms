/**
 * Verify that every identifier that belongs to OUR side of the traceability
 * matrix actually exists in the document that defines it.
 *
 * Our identifiers:
 *   FR-n, NFR-n, AC-n   -> requirements.md
 *   C-n, A-n, Q-n       -> requirements.md
 *   PQ-n                -> ui-analysis.md        (prototype questions)
 *   CQ-n                -> system-context.md     (context questions)
 *   B-n                 -> system-context.md     (failure boundaries)
 *
 * The BRD's own identifiers (BRD FR-nn and friends) are checked separately by
 * verify-br-ids.cjs, which derives them from docs/brief.md.
 *
 * Usage: node scripts/verify-our-ids.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = path.join(ROOT, 'memory-bank/intents/001-assisted-dyestuff-weighing-station');

// ── The identifier families and the document that defines each ───────────
const FAMILIES = [
  { kind: 'FR', src: 'requirements.md' },
  { kind: 'NFR', src: 'requirements.md' },
  { kind: 'AC', src: 'requirements.md' },
  { kind: 'C', src: 'requirements.md' },
  { kind: 'A', src: 'requirements.md' },
  { kind: 'Q', src: 'requirements.md' },
  { kind: 'PQ', src: 'ui-analysis.md' },
  { kind: 'CQ', src: 'system-context.md' },
  { kind: 'B', src: 'system-context.md' },
];

const defined = {};
for (const { kind, src } of FAMILIES) {
  const file = path.join(INTENT, src);
  const text = fs.readFileSync(file, 'utf8');
  const nums = new Set();
  // An identifier is "defined" by appearing in a heading, a table row, a
  // list item or a bold marker — i.e. as a standalone token, not as part of
  // a longer word.
  const re = new RegExp('(?:^|[^A-Za-z0-9-])' + kind + '-(\\d{1,2})(?![0-9])', 'gm');
  let m;
  while ((m = re.exec(text)) !== null) nums.add(Number(m[1]));
  defined[kind] = nums;
}

console.log('Our identifier ranges, derived from their defining documents:');
for (const { kind, src } of FAMILIES) {
  const nums = [...defined[kind]].sort((a, b) => a - b);
  console.log(
    `  ${kind}-n  (${src})  ` +
      (nums.length ? `${nums[0]}..${nums[nums.length - 1]}  (${nums.length} ids)` : 'NONE FOUND')
  );
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
    for (const { kind } of FAMILIES) {
      // Skip anything already carrying a "BRD " prefix — those are the BRD's.
      const re = new RegExp(
        '(?:^|[^A-Za-z0-9-])(' +
          (kind === 'C' || kind === 'A' || kind === 'Q' || kind === 'B' ? 'BRD\\s+' : '') +
          kind + '-(\\d{1,2}))(?![0-9])',
        'g'
      );
      let m;
      while ((m = re.exec(line)) !== null) {
        const token = m[1];
        const n = Number(m[2]);

        // If the token sits immediately after "BRD ", it belongs to the BRD
        // and is out of scope for this checker.
        const start = m.index + (m[0].length - token.length);
        const before = line.slice(Math.max(0, start - 5), start);
        if (/\bBRD\s+$/.test(before)) continue;

        if (!defined[kind].has(n)) {
          const nums = [...defined[kind]].sort((a, b) => a - b);
          problems.push(
            `${rel}:${i + 1}  ${kind}-${n} is not defined in ` +
              `${FAMILIES.find((x) => x.kind === kind).src}` +
              (nums.length ? ` (defined: ${nums[0]}..${nums[nums.length - 1]})` : '')
          );
        }
      }
    }
  });
}

console.log(`checked ${stories.length} story files`);

if (problems.length === 0) {
  console.log('\n✅ Every identifier we own, cited in a story, exists in its source document.');
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
