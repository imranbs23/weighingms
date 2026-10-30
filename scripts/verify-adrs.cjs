/**
 * Verify ADR documents and the decision index.
 *
 * Why this exists
 * ---------------
 * The decision index is the ONLY discovery mechanism for ADRs — a later bolt
 * finds prior decisions by scanning it. If the index drifts from the ADR
 * files, a later agent silently misses a constraint that was supposed to
 * guide it. That failure is invisible until something goes wrong.
 *
 * So this checks:
 *   1. Every ADR file has the required frontmatter and sections.
 *   2. ADR numbers are globally unique and contiguous from 1.
 *   3. Every ADR file appears in the decision index.
 *   4. Every index entry points at a file that exists.
 *   5. The index's total_decisions matches the real count.
 *   6. The index's last_updated is a valid timestamp.
 *   7. The index's Paths resolve relative to the bolt directories.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOLTS_DIR = path.join(ROOT, 'memory-bank/bolts');
const INDEX = path.join(ROOT, 'memory-bank/standards/decision-index.md');

const problems = [];

// ── collect ADR files ───────────────────────────────────────────────────────
const adrFiles = [];
if (fs.existsSync(BOLTS_DIR)) {
  for (const bolt of fs.readdirSync(BOLTS_DIR, { withFileTypes: true })) {
    if (!bolt.isDirectory()) continue;
    const dir = path.join(BOLTS_DIR, bolt.name);
    for (const f of fs.readdirSync(dir)) {
      if (/^adr-\d+-.+\.md$/.test(f)) {
        adrFiles.push({ bolt: bolt.name, file: f, path: path.join(dir, f) });
      }
    }
  }
}
adrFiles.sort((a, b) => a.file.localeCompare(b.file));

// ── 1 & 2: ADR frontmatter, sections, numbering ─────────────────────────────
const numbers = new Map();
for (const a of adrFiles) {
  const rel = path.relative(ROOT, a.path).replace(/\\/g, '/');
  const s = fs.readFileSync(a.path, 'utf8');

  const fmMatch = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    problems.push(`${rel}  missing frontmatter`);
    continue;
  }
  const fm = fmMatch[1];

  for (const key of ['bolt', 'created', 'status']) {
    if (!new RegExp(`^${key}:`, 'm').test(fm)) {
      problems.push(`${rel}  frontmatter missing "${key}"`);
    }
  }
  const statusMatch = fm.match(/^status:\s*(\S+)/m);
  if (statusMatch) {
    const ok = ['proposed', 'accepted', 'deprecated', 'superseded'];
    if (!ok.includes(statusMatch[1])) {
      problems.push(
        `${rel}  unknown status "${statusMatch[1]}" (expected one of ${ok.join(', ')})`
      );
    }
  }
  const createdMatch = fm.match(/^created:\s*(\S+)/m);
  if (createdMatch && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdMatch[1])) {
    problems.push(
      `${rel}  created "${createdMatch[1]}" is not YYYY-MM-DDTHH:MM:SSZ`
    );
  }

  for (const section of ['## Context', '## Decision', '## Rationale', '## Consequences', '## Related']) {
    if (!s.includes(section)) problems.push(`${rel}  missing section "${section}"`);
  }

  const headingMatch = s.match(/^#\s+ADR-(\d+):\s+(.+)$/m);
  if (!headingMatch) {
    problems.push(`${rel}  missing "# ADR-n: Title" heading`);
  } else {
    const n = Number(headingMatch[1]);
    const fromFile = Number(a.file.match(/^adr-(\d+)-/)[1]);
    if (n !== fromFile) {
      problems.push(`${rel}  heading says ADR-${n} but filename says adr-${fromFile}`);
    }
    if (numbers.has(n)) {
      problems.push(`${rel}  ADR-${n} duplicates ${numbers.get(n)}`);
    }
    numbers.set(n, rel);
  }
}

// contiguity from 1
const sorted = [...numbers.keys()].sort((x, y) => x - y);
for (let i = 0; i < sorted.length; i++) {
  if (sorted[i] !== i + 1) {
    problems.push(
      `ADR numbering is not contiguous from 1 — expected ADR-${i + 1}, found ADR-${sorted[i]}`
    );
    break;
  }
}

// ── 3–7: the decision index ────────────────────────────────────────────────
if (!fs.existsSync(INDEX)) {
  if (adrFiles.length) {
    problems.push(
      `decision-index.md is missing but ${adrFiles.length} ADR(s) exist — ` +
        `later bolts would never find them`
    );
  }
} else {
  const idx = fs.readFileSync(INDEX, 'utf8');
  const rel = path.relative(ROOT, INDEX).replace(/\\/g, '/');

  const totalMatch = idx.match(/^total_decisions:\s*(\d+)/m);
  if (!totalMatch) {
    problems.push(`${rel}  frontmatter missing "total_decisions"`);
  } else if (Number(totalMatch[1]) !== adrFiles.length) {
    problems.push(
      `${rel}  total_decisions says ${totalMatch[1]} but ${adrFiles.length} ADR file(s) exist`
    );
  }

  const luMatch = idx.match(/^last_updated:\s*(\S+)/m);
  if (!luMatch) {
    problems.push(`${rel}  frontmatter missing "last_updated"`);
  } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(luMatch[1])) {
    problems.push(`${rel}  last_updated "${luMatch[1]}" is not YYYY-MM-DDTHH:MM:SSZ`);
  }

  // index entries
  const entryRe = /^###\s+ADR-(\d+):\s+(.+)$/gm;
  const indexed = new Map();
  let m;
  while ((m = entryRe.exec(idx)) !== null) {
    const n = Number(m[1]);
    // capture the block for this entry
    const blockStart = m.index;
    const nextIdx = idx.indexOf('### ADR-', blockStart + 5);
    const block = idx.slice(blockStart, nextIdx === -1 ? idx.length : nextIdx);

    indexed.set(n, block);

    const pathMatch = block.match(/^\-\s+\*\*Path\*\*:\s+`([^`]+)`/m);
    if (!pathMatch) {
      problems.push(`${rel}  ADR-${n} entry has no **Path**`);
    } else {
      const p = pathMatch[1];
      // Paths are relative to memory-bank/bolts/
      const resolved = path.join(ROOT, 'memory-bank', p.replace(/^bolts\//, 'bolts/'));
      if (!fs.existsSync(resolved)) {
        problems.push(`${rel}  ADR-${n} Path does not resolve: ${p}`);
      }
    }
    for (const key of ['Status', 'Date', 'Bolt', 'Summary', 'Read when']) {
      if (!new RegExp(`^\\-\\s+\\*\\*${key}\\*\\*`, 'm').test(block)) {
        problems.push(`${rel}  ADR-${n} entry missing "**${key}**"`);
      }
    }
  }

  for (const [n, relPath] of numbers) {
    if (!indexed.has(n)) {
      problems.push(`${relPath}  ADR-${n} is NOT in the decision index`);
    }
  }
  for (const n of indexed.keys()) {
    if (!numbers.has(n)) {
      problems.push(`${rel}  index lists ADR-${n} but no such ADR file exists`);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`found ${adrFiles.length} ADR file(s)`);
if (numbers.size) {
  console.log(`numbered: ${sorted.map((n) => `ADR-${n}`).join(', ')}`);
}

if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  • ${p}`);
  process.exit(1);
} else {
  console.log('\n✅ Every ADR is well-formed and the decision index agrees.');
}
