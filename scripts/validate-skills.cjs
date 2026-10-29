// Validates the Puku skill files for required frontmatter fields and
// checks that each skill body preserves the upstream specs.md agent content.
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join('.puku-cli', 'skills');
const UPSTREAM_DIR = path.join('.specsmd', 'aidlc', 'agents');

const REQUIRED = ['name', 'description', 'when_to_use'];

// Maps skill dir -> upstream agent file
const UPSTREAM = {
  'specsmd-master-agent': 'master-agent.md',
  'specsmd-inception-agent': 'inception-agent.md',
  'specsmd-construction-agent': 'construction-agent.md',
  'specsmd-operations-agent': 'operations-agent.md',
};

// Known deliberate deviations from upstream, with the reason. These are the
// specs.md v0.1.74 operations skill-table rows that name files the package
// does not actually ship (menu.md, rollback.md). The skill points at the real
// files on disk instead, and documents the mapping.
const KNOWN_DEVIATIONS = {
  'specsmd-operations-agent': [
    '| `menu` | `.specsmd/aidlc/skills/operations/menu.md` | Show deployment status and options |',
    '| `deploy` | `.specsmd/aidlc/skills/operations/deploy.md` | Deploy to environment |',
    '| `verify` | `.specsmd/aidlc/skills/operations/verify.md` | Verify deployment success |',
    '| `rollback` | `.specsmd/aidlc/skills/operations/rollback.md` | Rollback to previous version |',
  ],
};

let allOk = true;

for (const dirName of fs.readdirSync(SKILLS_DIR)) {
  const skillPath = path.join(SKILLS_DIR, dirName, 'SKILL.md');
  const text = fs.readFileSync(skillPath, 'utf8');

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    console.log('FAIL  no frontmatter block:', dirName);
    allOk = false;
    continue;
  }

  const frontmatter = match[1];
  const body = text.slice(match[0].length);

  const fields = {};
  for (const key of REQUIRED) {
    const m = frontmatter.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    fields[key] = m ? m[1].trim() : null;
  }

  if (fields.name !== dirName) {
    console.log('FAIL  name/dir mismatch:', dirName, '->', fields.name);
    allOk = false;
  }
  for (const key of REQUIRED) {
    if (!fields[key]) {
      console.log('FAIL  missing field "' + key + '":', dirName);
      allOk = false;
    }
  }

  // Fidelity: every non-heading line of the upstream agent body should survive
  const upstreamPath = path.join(UPSTREAM_DIR, UPSTREAM[dirName]);
  const upstream = fs.readFileSync(upstreamPath, 'utf8');
  const upstreamLines = upstream
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));

  const bodyText = body.replace(/\r/g, '');
  const allowed = KNOWN_DEVIATIONS[dirName] || [];
  const missing = upstreamLines.filter(
    (l) => !bodyText.includes(l) && !allowed.includes(l)
  );

  const status = missing.length === 0 ? 'FAITHFUL' : 'MISSING ' + missing.length;
  console.log(
    'OK    ' + dirName.padEnd(28) +
    'fields=' + REQUIRED.filter((k) => fields[k]).length + '/' + REQUIRED.length +
    '  upstreamLines=' + upstreamLines.length +
    '  missing=' + missing.length + '  ' + status
  );

  if (missing.length > 0) {
    allOk = false;
    missing.slice(0, 5).forEach((l) => console.log('        - ' + l.slice(0, 90)));
  }
}

console.log(allOk ? '\nALL SKILLS VALID' : '\nSKILL VALIDATION FAILED');
process.exit(allOk ? 0 : 1);
