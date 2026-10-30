/**
 * Sync the "Bolt Suggestions" table in each unit-brief.md with the real bolt
 * plan.
 *
 * The unit briefs were written in Step 10, before the stories existed and
 * long before the bolt plan was planned. Their Bolt Suggestions tables are
 * therefore proposals, and they have drifted: unit 006 gained a sixth story
 * after the FR-23 gap was found, and the real bolt numbering is a global
 * sequence across all units, not a per-unit one.
 *
 * This script rewrites each unit brief's Bolt Suggestions table from
 * memory-bank/bolts/, so the briefs describe the plan that will actually be
 * executed rather than the one that was guessed at.
 *
 * Usage: node scripts/sync-bolt-suggestions.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = path.join(
  ROOT,
  'memory-bank/intents/001-assisted-dyestuff-weighing-station'
);
const BOLTS_DIR = path.join(ROOT, 'memory-bank', 'bolts');

// ── Read the real plan ───────────────────────────────────────────────────
const bolts = [];
for (const dir of fs.readdirSync(BOLTS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(BOLTS_DIR, dir.name, 'bolt.md');
  if (!fs.existsSync(file)) continue;

  const text = fs.readFileSync(file, 'utf8');
  const id = /^id:\s*(\S+)/m.exec(text)?.[1] || dir.name;
  const unit = /^unit:\s*(\S+)/m.exec(text)?.[1];
  const type = /^type:\s*(\S+)/m.exec(text)?.[1];
  const objective = /^## Objective\n\n(.+)$/m.exec(text)?.[1]?.trim() || '';
  const stories = [];
  const sm = /^stories:\n((?:  - .+\n?)*)/m.exec(text);
  if (sm) {
    for (const l of sm[1].split('\n')) {
      const v = /^\s*-\s+(.+)$/.exec(l);
      if (v) stories.push(v[1].trim());
    }
  }
  const notes = /^## Notes\n\n(.+)$/m.exec(text)?.[1]?.trim() || '';
  bolts.push({ id, unit, type, objective, stories, notes });
}

const byUnit = new Map();
for (const b of bolts) {
  if (!byUnit.has(b.unit)) byUnit.set(b.unit, []);
  byUnit.get(b.unit).push(b);
}

/** The first sentence of the objective — a one-line description for the table. */
function summarise(objective) {
  const first = objective.split(/(?<=\.)\s/)[0] || objective;
  return first.length > 110 ? first.slice(0, 107).trimEnd() + '…' : first;
}

// ── Rewrite each unit brief ──────────────────────────────────────────────
let changed = 0;

for (const [unit, unitBolts] of byUnit) {
  const briefPath = path.join(INTENT, 'units', unit, 'unit-brief.md');
  if (!fs.existsSync(briefPath)) continue;

  let text = fs.readFileSync(briefPath, 'utf8');

  const header = '## Bolt Suggestions';
  const hIdx = text.indexOf(header);
  if (hIdx === -1) {
    console.log(`  ! ${unit} — no "Bolt Suggestions" section; skipped`);
    continue;
  }

  // The section runs until the next top-level "## " heading.
  const rest = text.slice(hIdx + header.length);
  const nextIdx = rest.search(/\n##\s/);
  const sectionEnd = nextIdx === -1 ? text.length : hIdx + header.length + nextIdx + 1;
  const before = text.slice(0, hIdx);
  let after = text.slice(sectionEnd);

  // The horizontal rule that separates this section from the next one sits
  // just before the next heading, so it is inside the slice we replaced. Put
  // it back, or the following heading loses its rule.
  const hadRule = /\n---\n*$/.test(text.slice(hIdx, sectionEnd));
  if (!hadRule) {
    after = after.replace(/^\n*/, '\n---\n\n');
  }

  const rows = unitBolts.map((b) => {
    const kind = b.type === 'simple-construction-bolt' ? 'Simple' : 'DDD';
    const storyList = b.stories.join(', ');
    return `| \`${b.id}\` | ${kind} | ${storyList} | ${summarise(b.objective)} |`;
  });

  const section = [
    header,
    '',
    '> Generated from the bolt plan in `memory-bank/bolts/` by',
    '> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**',
    '> sequence across all units, not a per-unit one.',
    '',
    '| Bolt | Type | Stories | Objective |',
    '|------|------|---------|-----------|',
    ...rows,
    '',
  ].join('\n');

  const updated = before + section + after;
  if (updated !== text) {
    fs.writeFileSync(briefPath, updated, 'utf8');
    changed++;
    console.log(`  updated ${unit} — ${unitBolts.length} bolt(s)`);
  }
}

console.log(`\n${changed} unit brief(s) updated.`);
