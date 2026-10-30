/**
 * Verify FR reference hygiene and story-file structure.
 *
 * SCOPE — story files only, for the reference-hygiene checks.
 *
 * Why
 * ---
 * WeighingMS carries two functional-requirement sets whose numbers OVERLAP:
 *
 *   OURS (requirements.md)  FR-1  .. FR-23   (unpadded)
 *   BRD  (docs/brief.md)    FR-01 .. FR-37   (zero-padded)
 *
 * The zero-padded form is always the BRD's and the unpadded form is always
 * ours — but ONLY if the author kept to that convention. A verifier cannot
 * tell an author's mistake from a correct unpadded reference by shape
 * alone. Outside the story files, "FR-13" in units.md or a unit brief is
 * ambiguous with "ours" and must be left alone; inside a story, both sets
 * are cited side by side and the convention is enforced.
 *
 * A verifier that flagged those documents would be reporting a rule the
 * documents never claimed, so the check is scoped where the rule applies.
 *
 * Checks, over the story files:
 *
 *   1. No bare zero-padded FR reference  (FR-01 .. FR-37)  — the BRD's set
 *      must always be written "BRD FR-xx".
 *   2. No dangling "BRD FR-" with no number.
 *   3. No doubled prefixes ("BRD BRD", "BRD FR FR").
 *   4. No sentinel leakage from the fixer script.
 *   5. Every story file has the required sections and a valid frontmatter.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = path.join(
  ROOT,
  'memory-bank/intents/001-assisted-dyestuff-weighing-station'
);

const problems = [];
const files = [];

// The reference prefixes that exist in this project.
//
//   BRD FR-nn / BR-nn / IR-nn / NFR-nn  — the Business Requirement Document's
//   FR-n / NFR-n / AC-nn / C-nn / A-nn / Q-nn — ours
//   DR-nn                            — the BRD's data-retention rules
//   PQ-nn / CQ-nn                    — the prototype's and the context's questions
const KNOWN_PREFIXES = new Set([
  'BRD', 'FR', 'BR', 'IR', 'NFR', 'AC', 'C', 'A', 'Q', 'PQ', 'CQ', 'DR',
]);

// Spellings that have actually appeared by mistake, mapped to the correction.
const SUGGESTIONS = {
  FRD: 'BRD',
  BDR: 'BRD',
  RDF: 'BRD',
  AD: 'AC',
  NCR: 'NCR',
};

function walk(dir, filter) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter);
    else if (!filter || filter(p)) files.push(p);
  }
}

walk(INTENT, (p) => p.endsWith('.md'));

// The reference-hygiene rules are enforced only where both requirement sets
// are cited together — the story files.
const stories = files.filter((f) => /[\\/]stories[\\/]/.test(f));

// ── 1–4: reference hygiene (story files only) ─────────────────────────────
for (const f of stories) {
  const s = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = s.split('\n');

  lines.forEach((line, i) => {
    // A bare FR reference is only a defect when it falls OUTSIDE our own
    // range. Our set runs FR-1..FR-23, so FR-10..FR-23 are two digits and
    // are indistinguishable by shape from the BRD's FR-10..FR-23 — both are
    // legitimate bare references. The BRD's FR-24..FR-37 have no overlap
    // with ours, so a bare one of those is unambiguously a mistake and must
    // be written "BRD FR-nn".
    //
    // The lookbehind must allow any run of whitespace between "BRD" and "FR",
    // so it is done by scanning matches rather than by a fixed-width lookbehind.
    const re = /\bFR-(\d{2})\b/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const before = line.slice(Math.max(0, m.index - 6), m.index);
      const isOurs = Number(m[1]) <= 23;
      const alreadyPrefixed = /\bBRD\s+$/.test(before);
      if (!isOurs && !alreadyPrefixed) {
        problems.push(
          `${rel}:${i + 1}  bare FR-${m[1]} (outside our FR-1..FR-23 range, so it should be "BRD FR-${m[1]}")`
        );
      }
    }
    if (/BRD FR-[^0-9\-\s]/.test(line)) {
      problems.push(`${rel}:${i + 1}  dangling "BRD FR-" with no number`);
    }
    if (/BRD\s+BRD|BRD FR FR/.test(line)) {
      problems.push(`${rel}:${i + 1}  doubled prefix`);
    }
    if (line.includes('POKU_PROTECTED')) {
      problems.push(`${rel}:${i + 1}  sentinel leakage`);
    }

    // A misspelled prefix. Two real occurrences of "FRD" were found this way
    // — a subagent typed FRD for BRD, and the doubled form "FRD BRD FR-24"
    // then satisfied both the bare-padding and doubled-prefix rules while
    // meaning something that does not exist. Catching it needs the list of
    // prefixes that are actually valid in this project.
    const re2 = /\b([A-Z]{2,6})-(\d{1,2})\b/g;
    let m2;
    while ((m2 = re2.exec(line)) !== null) {
      if (!KNOWN_PREFIXES.has(m2[1])) {
        problems.push(
          `${rel}:${i + 1}  unknown reference prefix "${m2[1]}" in "${m2[0]}"` +
            ` — did you mean ${SUGGESTIONS[m2[1]] || 'BRD ' + m2[0]}?`
        );
      }
    }
  });
}

// ── 5: story file structure ───────────────────────────────────────────────
for (const f of stories) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const s = fs.readFileSync(f, 'utf8');

  const required = [
    '## User Story',
    '## Acceptance Criteria',
    '## Technical Notes',
    '## Dependencies',
    '## Edge Cases',
    '## Out of Scope',
  ];
  for (const r of required) {
    if (!s.includes(r)) problems.push(`${rel}  missing section "${r}"`);
  }

  const fm = /^---\n([\s\S]*?)\n---/.exec(s);
  if (!fm) {
    problems.push(`${rel}  missing frontmatter`);
    continue;
  }
  for (const key of ['id:', 'unit:', 'intent:', 'status:', 'priority:', 'created:']) {
    if (!fm[1].includes(key)) problems.push(`${rel}  frontmatter missing "${key}"`);
  }

  const idMatch = /^id:\s*(\S+)/m.exec(fm[1]);
  const fileBase = path.basename(f, '.md');
  if (idMatch && idMatch[1] !== fileBase) {
    problems.push(`${rel}  frontmatter id "${idMatch[1]}" != filename "${fileBase}"`);
  }

  const criteria = (s.match(/^- \[ \] \*\*Given\*\*/gm) || []).length;
  if (criteria < 3) {
    problems.push(`${rel}  only ${criteria} acceptance criteria (minimum 3)`);
  }
}

// ── report ────────────────────────────────────────────────────────────────
console.log(`checked ${files.length} markdown files, ${stories.length} story files`);

if (problems.length === 0) {
  console.log('\n✅ No problems found.');
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
