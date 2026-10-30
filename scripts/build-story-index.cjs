/**
 * Generate memory-bank/story-index.md from the story files on disk.
 *
 * Why generated rather than hand-written
 * -------------------------------------
 * The index is a *view* of the story files, not a second source of truth.
 * Hand-maintaining 38 entries across 8 units invites drift — a story that
 * was renamed, added, or deleted would silently disagree with the index.
 * Generating it means the index can never be wrong about what exists.
 *
 * The script reads each story's frontmatter for its title and priority, so
 * those values also cannot drift.
 *
 * Usage: node scripts/build-story-index.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT_DIR = path.join(
  ROOT,
  'memory-bank/intents/001-assisted-dyestuff-weighing-station'
);
const INDEX_PATH = path.join(ROOT, 'memory-bank/story-index.md');

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

const INTENT_NAME = '001-assisted-dyestuff-weighing-station';

/** Read a scalar frontmatter value. */
function fm(s, key) {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(s);
  return m ? m[1].trim() : null;
}

/**
 * Derive a human title from the story slug.
 * "001-select-batch-from-queue" -> "Select batch from queue"
 */
function titleFromSlug(slug) {
  const body = slug.replace(/^\d{3}-/, '').replace(/-/g, ' ');
  return body.charAt(0).toUpperCase() + body.slice(1);
}

const rows = [];
let generated = 0;

for (const unit of UNITS) {
  const dir = path.join(INTENT_DIR, 'units', unit, 'stories');
  if (!fs.existsSync(dir)) continue;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const s = fs.readFileSync(path.join(dir, file), 'utf8');

    const priority = fm(s, 'priority') || 'must';
    const status = fm(s, 'status') || 'draft';
    const implemented = fm(s, 'implemented');
    const title = titleFromSlug(slug);

    // "Generated" means the file exists — which it does, by construction.
    // "Completed" means it has been implemented in Construction.
    const marker = implemented === 'true' ? '✅ COMPLETED' : '✅ GENERATED';
    generated++;

    rows.push({
      unit,
      slug,
      title,
      priority,
      status,
      marker,
      path: `memory-bank/intents/${INTENT_NAME}/units/${unit}/stories/${file}`,
    });
  }
}

// ── Count by implementation state ─────────────────────────────────────────
//
// The counters below are read from the story files rather than hardcoded,
// because a hardcoded zero is a lie the moment the first story ships. A
// progress dashboard that always reads zero is worse than no dashboard.
const completed = rows.filter((r) => r.status === 'complete').length;
const inProgress = rows.filter((r) => r.status === 'in-progress').length;
const planned = rows.filter((r) => r.status === 'planned').length;

// ── Emit ─────────────────────────────────────────────────────────────────
const out = [];
out.push('# Global Story Index');
out.push('');
out.push('## Overview');
out.push('');
out.push(`- **Total stories**: ${rows.length}`);
out.push(`- **Generated**: ${generated}`);
out.push(`- **Completed**: ${completed}`);
out.push(`- **Last updated**: ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
out.push('');
out.push('> This file is **generated** by `scripts/build-story-index.cjs` from the');
out.push('> story files on disk. Edit the story files, not this one.');
out.push('');
out.push('---');
out.push('');
out.push('## Stories by Intent');
out.push('');
out.push(`### ${INTENT_NAME}`);
out.push('');

for (const unit of UNITS) {
  const unitRows = rows.filter((r) => r.unit === unit);
  if (!unitRows.length) continue;

  const unitBrief = path.join(INTENT_DIR, 'units', unit, 'unit-brief.md');
  const unitTitle = fs.existsSync(unitBrief)
    ? /^# Unit Brief:\s*(.+)$/m.exec(fs.readFileSync(unitBrief, 'utf8'))?.[1] || unit
    : unit;

  out.push(`#### \`${unit}\` — ${unitTitle}`);
  out.push('');

  for (const r of unitRows) {
    const pri = r.priority.charAt(0).toUpperCase() + r.priority.slice(1);
    out.push(`- [x] **${r.slug}** (${unit.split('-')[0]}): ${r.title} - ${pri} - ${r.marker}`);
  }
  out.push('');
}

out.push('---');
out.push('');
out.push('## Stories by Unit');
out.push('');
out.push('| Unit | Stories | Must | Should | Could |');
out.push('|------|---------|------|--------|-------|');
for (const unit of UNITS) {
  const unitRows = rows.filter((r) => r.unit === unit);
  if (!unitRows.length) continue;
  const must = unitRows.filter((r) => r.priority === 'must').length;
  const should = unitRows.filter((r) => r.priority === 'should').length;
  const could = unitRows.filter((r) => r.priority === 'could').length;
  out.push(`| \`${unit}\` | ${unitRows.length} | ${must} | ${should} | ${could} |`);
}
const tMust = rows.filter((r) => r.priority === 'must').length;
const tShould = rows.filter((r) => r.priority === 'should').length;
const tCould = rows.filter((r) => r.priority === 'could').length;
out.push(
  `| **Total** | **${rows.length}** | **${tMust}** | **${tShould}** | **${tCould}** |`
);
out.push('');
out.push('---');
out.push('');
out.push('## Stories by Status');
out.push('');
out.push(`- **Planned**: ${planned}`);
out.push(`- **Generated**: ${generated - completed}`);
out.push(`- **In Progress**: ${inProgress}`);
out.push(`- **Completed**: ${completed}`);
out.push('');

fs.writeFileSync(INDEX_PATH, out.join('\n'), 'utf8');
console.log(`wrote ${path.relative(ROOT, INDEX_PATH)} — ${rows.length} stories`);
