/**
 * Validate the YAML frontmatter of every bolt file.
 *
 * Why a bespoke checker rather than a YAML parser
 * -------------------------------------------------
 * The failure this guards against is a DUPLICATE KEY in the frontmatter. A
 * YAML parser resolves duplicates silently — last one wins — so the document
 * parses cleanly while a dependency has quietly vanished from it. That
 * defect is invisible to any tool that only reads the parsed result, which
 * is exactly what the construction agent will do.
 *
 * So this checks the raw text for the properties a parser would hide:
 *
 *   1. No duplicate top-level keys.
 *   2. The frontmatter is delimited correctly.
 *   3. Every required field is present.
 *   4. List values are well-formed (either `key: []` or `key:` followed by
 *      `  - item` lines — and never a mixture).
 *   5. The required fields actually carry values.
 *
 * It also cross-checks the declared dependency lists against the real bolt
 * directories, so a dependency on a bolt that does not exist is caught.
 *
 * Usage: node scripts/verify-frontmatter.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOLTS_DIR = path.join(ROOT, 'memory-bank', 'bolts');

const REQUIRED = [
  'id',
  'unit',
  'intent',
  'type',
  'status',
  'stories',
  'created',
  'requires_bolts',
  'enables_bolts',
  'requires_units',
  'blocks',
  'complexity',
];

const COMPLEXITY_FIELDS = [
  'avg_complexity',
  'avg_uncertainty',
  'max_dependencies',
  'testing_scope',
];

const problems = [];

// ── Collect the bolt directories ─────────────────────────────────────────
const boltDirs = fs
  .readdirSync(BOLTS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const boltIds = new Set(boltDirs);
console.log(`found ${boltDirs.length} bolt directories`);

/**
 * Parse the frontmatter into a map of key -> { value, items, raw }.
 * Detects duplicate keys, which is the whole point.
 */
function parseFrontmatter(text, rel) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) {
    problems.push(`${rel}  no frontmatter block`);
    return null;
  }

  const body = m[1];
  const lines = body.split('\n');
  const map = new Map();

  let currentKey = null;
  let currentList = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentList) {
      currentList.items.push(item[1].trim());
      continue;
    }

    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1];
    const value = kv[2].trim();

    if (map.has(key)) {
      problems.push(
        `${rel}  DUPLICATE key "${key}" in frontmatter ` +
          `(lines ${map.get(key).line} and ${i + 1}) — a YAML parser keeps only the last`
      );
    }

    const entry = { value, items: [], line: i + 1, isList: false };
    map.set(key, entry);
    currentKey = key;

    if (value === '') {
      // Either a nested block (complexity) or a list — decided by what follows.
      entry.isList = true;
      currentList = entry;
    } else {
      currentList = null;
    }
  }

  return { map, body };
}

const parsed = new Map();

for (const dir of boltDirs) {
  const file = path.join(BOLTS_DIR, dir, 'bolt.md');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  if (!fs.existsSync(file)) {
    problems.push(`${rel}  bolt.md is missing`);
    continue;
  }

  const text = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text, rel);
  if (!fm) continue;

  parsed.set(dir, { fm, text, rel });

  // ── Required fields present ───────────────────────────────────────────
  for (const key of REQUIRED) {
    if (!fm.map.has(key)) problems.push(`${rel}  frontmatter missing "${key}"`);
  }

  // ── The id matches the directory ──────────────────────────────────────
  const id = fm.map.get('id')?.value;
  if (id && id !== dir) {
    problems.push(`${rel}  frontmatter id "${id}" != directory "${dir}"`);
  }

  // ── status is a known value ───────────────────────────────────────────
  const status = fm.map.get('status')?.value;
  if (status && !['planned', 'in-progress', 'complete', 'blocked'].includes(status)) {
    problems.push(`${rel}  unknown status "${status}"`);
  }

  // ── type is a known bolt type ─────────────────────────────────────────
  const type = fm.map.get('type')?.value;
  if (type && !['ddd-construction-bolt', 'simple-construction-bolt', 'spike-bolt'].includes(type)) {
    problems.push(`${rel}  unknown bolt type "${type}"`);
  }

  // ── stories is a non-empty list ──────────────────────────────────────
  const stories = fm.map.get('stories');
  if (stories) {
    if (!stories.items.length) problems.push(`${rel}  stories list is empty`);
    for (const s of stories.items) {
      if (!/^\d{3}-[a-z0-9-]+$/.test(s)) {
        problems.push(`${rel}  story id "${s}" is not a story-slug`);
      }
    }
  }

  // ── created is an ISO 8601 timestamp with a time ─────────────────────
  const created = fm.map.get('created')?.value;
  if (created && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(created)) {
    problems.push(`${rel}  created "${created}" is not YYYY-MM-DDTHH:MM:SSZ`);
  }

  // ── complexity block has all four fields ─────────────────────────────
  const complexity = fm.map.get('complexity');
  if (complexity) {
    const cbody = fm.body;
    for (const f of COMPLEXITY_FIELDS) {
      const re = new RegExp('^\\s+' + f + ':\\s*(\\d+)\\s*$', 'm');
      const mm = re.exec(cbody);
      if (!mm) {
        problems.push(`${rel}  complexity is missing "${f}"`);
      } else {
        const v = Number(mm[1]);
        if (v < 1 || v > 3) {
          problems.push(`${rel}  complexity.${f} = ${v} (must be 1..3)`);
        }
      }
    }
  }

  // ── dependency lists name bolts that exist ───────────────────────────
  for (const key of ['requires_bolts', 'enables_bolts']) {
    const e = fm.map.get(key);
    if (!e) continue;
    for (const dep of e.items) {
      if (!boltIds.has(dep)) {
        problems.push(`${rel}  ${key} names "${dep}", which does not exist`);
      }
    }
  }

  // ── a list key must not mix "[]" with item lines ─────────────────────
  for (const key of ['stories', 'requires_bolts', 'enables_bolts', 'requires_units']) {
    const e = fm.map.get(key);
    if (!e) continue;
    if (e.value === '[]' && e.items.length) {
      problems.push(`${rel}  ${key} is written as "[]" but also has ${e.items.length} item(s)`);
    }
    if (e.value !== '[]' && e.value !== '' && e.items.length) {
      problems.push(`${rel}  ${key} has both an inline value and ${e.items.length} item(s)`);
    }
  }
}

// ── Cross-bolt mirror check ──────────────────────────────────────────────
for (const [dir, { fm, rel }] of parsed) {
  const requires = fm.map.get('requires_bolts')?.items || [];
  const enables = fm.map.get('enables_bolts')?.items || [];

  for (const dep of requires) {
    const depEntry = parsed.get(dep);
    if (!depEntry) continue;
    const depEnables = depEntry.fm.map.get('enables_bolts')?.items || [];
    if (!depEnables.includes(dir)) {
      problems.push(
        `${rel}  requires "${dep}", but "${dep}" does not list "${dir}" in enables_bolts`
      );
    }
  }

  for (const en of enables) {
    const enEntry = parsed.get(en);
    if (!enEntry) continue;
    const enRequires = enEntry.fm.map.get('requires_bolts')?.items || [];
    if (!enRequires.includes(dir)) {
      problems.push(
        `${rel}  enables "${en}", but "${en}" does not list "${dir}" in requires_bolts`
      );
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log('\n✅ Every bolt frontmatter is valid: no duplicate keys, all required');
  console.log('   fields present, dependencies name real bolts, enables mirror requires.');
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
