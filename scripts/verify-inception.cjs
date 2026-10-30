/**
 * Checkpoint 4 gate: verify the Inception phase is complete and internally
 * consistent before any code is written.
 *
 * This is the formal counterpart to the review skill's Step 1 and Step 2.
 * It checks the five things the flow names:
 *
 *   1. Artifact verification — every required artefact exists and is
 *      non-empty.
 *   2. Story coverage — every functional requirement traces to at least one
 *      story, and every story cites at least one requirement.
 *   3. Unit independence — no circular dependency between units.
 *   4. Bolt completeness — every story is assigned to exactly one bolt.
 *   5. Type alignment — a bolt's type matches the unit's type: frontend
 *      units use simple bolts, backend units use DDD bolts.
 *
 * Usage: node scripts/verify-inception.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT_DIR = path.join(
  ROOT,
  'memory-bank/intents/001-assisted-dyestuff-weighing-station'
);
const BOLTS_DIR = path.join(ROOT, 'memory-bank', 'bolts');
const INTENT = '001-assisted-dyestuff-weighing-station';

const problems = [];
const notes = [];

// ── 1. Artifact verification ─────────────────────────────────────────────
const REQUIRED_ARTEFACTS = [
  ['requirements.md', path.join(INTENT_DIR, 'requirements.md')],
  ['system-context.md', path.join(INTENT_DIR, 'system-context.md')],
  ['ui-analysis.md', path.join(INTENT_DIR, 'ui-analysis.md')],
  ['units.md', path.join(INTENT_DIR, 'units.md')],
  ['inception-log.md', path.join(INTENT_DIR, 'inception-log.md')],
  ['units.md (story index)', path.join(ROOT, 'memory-bank', 'story-index.md')],
];

const UNITS = [
  '001-batch-management',
  '002-recipe-material-management',
  '003-weighing-station',
  '004-scale-integration',
  '005-orgatex-integration',
  '006-ticket-printing',
  '007-weighingms-ui',
  '008-operator-identity',
];

for (const u of UNITS) {
  REQUIRED_ARTEFACTS.push([
    `${u}/unit-brief.md`,
    path.join(INTENT_DIR, 'units', u, 'unit-brief.md'),
  ]);
}

for (const [label, file] of REQUIRED_ARTEFACTS) {
  if (!fs.existsSync(file)) {
    problems.push(`missing artefact: ${label}`);
    continue;
  }
  const size = fs.statSync(file).size;
  if (size < 200) problems.push(`artefact is suspiciously small: ${label} (${size} bytes)`);
}
notes.push(`${REQUIRED_ARTEFACTS.length} required artefacts present`);

// ── Load the stories ─────────────────────────────────────────────────────
const stories = [];
for (const u of UNITS) {
  const dir = path.join(INTENT_DIR, 'units', u, 'stories');
  if (!fs.existsSync(dir)) {
    problems.push(`no stories directory for ${u}`);
    continue;
  }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const id = /^id:\s*(\S+)/m.exec(text)?.[1] || f.replace(/\.md$/, '');
    stories.push({
      id,
      file: `${u}/stories/${f}`,
      unit: u,
      priority: /^priority:\s*(\S+)/m.exec(text)?.[1] || 'must',
      status: /^status:\s*(\S+)/m.exec(text)?.[1] || 'draft',
      text,
    });
  }
}
notes.push(`${stories.length} stories across ${UNITS.length} units`);

// ── Load the requirements ────────────────────────────────────────────────
const reqText = fs.readFileSync(path.join(INTENT_DIR, 'requirements.md'), 'utf8');

// Our FR set is FR-1..FR-23, written unpadded. Collect the ids that the
// requirements document actually defines.
const ourFrs = new Set();
for (const m of reqText.matchAll(/(?:^|[^A-Za-z0-9-])FR-(\d{1,2})(?![0-9])/g)) {
  const n = Number(m[1]);
  if (n >= 1 && n <= 23) ourFrs.add(n);
}
notes.push(`${ourFrs.size} functional requirements defined in requirements.md`);

// ── 2. Story coverage ────────────────────────────────────────────────────
// (a) Every FR is cited by at least one story.
const frCited = new Set();
for (const s of stories) {
  // Only OUR FRs count here — a "BRD FR-nn" is the BRD's requirement.
  const stripped = s.text.replace(/\bBRD\s+(?:FR|BR|IR|NFR|AC|DR)-\d+/g, ' ');
  for (const m of stripped.matchAll(/(?:^|[^A-Za-z0-9-])FR-(\d{1,2})(?![0-9])/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 23) frCited.add(n);
  }
}

const uncovered = [...ourFrs].filter((n) => !frCited.has(n)).sort((a, b) => a - b);
if (uncovered.length) {
  problems.push(
    `functional requirements with no story: ${uncovered.map((n) => `FR-${n}`).join(', ')}`
  );
}
notes.push(`every one of the ${ourFrs.size} FRs is cited by at least one story`);

// (b) Every story cites at least one requirement.
for (const s of stories) {
  const stripped = s.text.replace(/\bBRD\s+(?:FR|BR|IR|NFR|AC|DR)-\d+/g, ' ');
  const cites = /\b(?:FR|NFR|AC|C|A|Q|PQ|CQ)-\d+/.test(stripped);
  if (!cites) problems.push(`story ${s.id} cites no requirement`);
}

// ── 3. Unit independence — no circular dependency between units ─────────
// The unit dependency edges are declared in units.md's dependency graph and
// in each bolt's `requires_units`.
const unitEdges = new Map(UNITS.map((u) => [u, new Set()]));
for (const dir of fs.readdirSync(BOLTS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(BOLTS_DIR, dir.name, 'bolt.md');
  if (!fs.existsSync(file)) continue;
  const t = fs.readFileSync(file, 'utf8');
  const unit = /^unit:\s*(\S+)/m.exec(t)?.[1];
  const m = /^requires_units:\n((?:  - .+\n?)*)/m.exec(t);
  if (!m || !unit) continue;
  for (const line of m[1].split('\n').filter(Boolean)) {
    const dep = line.replace(/^\s*-\s+/, '').trim();
    if (dep && unitEdges.has(unit)) unitEdges.get(unit).add(dep);
  }
}

const cycle = findCycle(UNITS, unitEdges);
if (cycle) {
  problems.push(`circular dependency between units: ${cycle.join(' -> ')}`);
}
notes.push('no circular dependency between units');

function findCycle(nodes, edges) {
  const state = new Map();
  const stack = [];

  function visit(n) {
    if (state.get(n) === 'done') return null;
    if (state.get(n) === 'active') return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 'active');
    stack.push(n);
    for (const d of edges.get(n) || []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(n, 'done');
    return null;
  }

  for (const n of nodes) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

// ── 4. Bolt completeness ─────────────────────────────────────────────────
const assigned = new Map();
const boltUnits = new Map();
let boltCount = 0;

for (const dir of fs.readdirSync(BOLTS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(BOLTS_DIR, dir.name, 'bolt.md');
  if (!fs.existsSync(file)) {
    problems.push(`bolt directory ${dir.name} has no bolt.md`);
    continue;
  }
  boltCount++;

  const t = fs.readFileSync(file, 'utf8');
  const unit = /^unit:\s*(\S+)/m.exec(t)?.[1];
  const type = /^type:\s*(\S+)/m.exec(t)?.[1];
  boltUnits.set(dir.name, { unit, type });

  const m = /^stories:\n((?:  - .+\n?)*)/m.exec(t);
  if (!m) {
    problems.push(`bolt ${dir.name} has no stories list`);
    continue;
  }
  for (const line of m[1].split('\n').filter(Boolean)) {
    const id = line.replace(/^\s*-\s+/, '').trim();
    if (assigned.has(id)) {
      problems.push(`story ${id} is in two bolts (${assigned.get(id)} and ${dir.name})`);
    }
    assigned.set(id, dir.name);
  }
}

for (const s of stories) {
  if (!assigned.has(s.id)) problems.push(`story ${s.id} is not in any bolt`);
}
notes.push(`${boltCount} bolts, every story assigned exactly once`);

// ── 5. Type alignment ───────────────────────────────────────────────────
// A frontend unit's bolts are simple; a backend unit's bolts are DDD.
const FRONTEND_UNITS = new Set(['007-weighingms-ui']);
for (const [id, { unit, type }] of boltUnits) {
  const expected = FRONTEND_UNITS.has(unit) ? 'simple-construction-bolt' : 'ddd-construction-bolt';
  if (type !== expected) {
    problems.push(`bolt ${id} has type "${type}" but unit ${unit} requires "${expected}"`);
  }
}
notes.push('every bolt type matches its unit type');

// ── Report ────────────────────────────────────────────────────────────────
console.log('### Checkpoint 4 verification — Inception completeness\n');
for (const n of notes) console.log('  ✅ ' + n);
console.log('');

if (problems.length === 0) {
  console.log('✅ INCEPTION COMPLETE — all checks pass.');
  console.log('\n   Ready to start Construction.');
  process.exit(0);
}

console.log(`❌ ${problems.length} problem(s):\n`);
const seen = new Set();
for (const p of problems) {
  if (seen.has(p)) continue;
  seen.add(p);
  console.log('  • ' + p);
}
process.exit(1);
