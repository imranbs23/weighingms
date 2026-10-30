/**
 * Normalise memory-bank markdown files to LF line endings.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The specs.md framework scripts read YAML frontmatter with the pattern
 *
 *     content.match(/^---\n([\s\S]+?)\n---/)
 *
 * which requires LF. A file written with CRLF has `---\r\n` and does NOT
 * match, so `extractFrontmatter` returns null and the script reports
 * "Invalid ... frontmatter, skipping" and moves on.
 *
 * That message is misleading — the frontmatter is valid YAML — and the
 * consequence is silent: a unit brief's `status` is never updated to
 * `complete`, and the intent's status never advances. Every future
 * `bolt-complete` run would report success while leaving the memory bank
 * lying about what is finished.
 *
 * The bolt file itself was unaffected because `bolt-complete.cjs` REWRITES
 * it with `yaml.dump` + LF endings — which is why the problem appeared
 * only after that script had run once.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Converts CRLF to LF in the listed files, then RE-VERIFIES each one by
 * parsing its frontmatter with the framework's exact regex and YAML
 * loader. Any file that does not parse afterwards is reported and the
 * script exits non-zero, so a silent regression is impossible.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

/** The framework's exact frontmatter pattern — LF only. */
const FRONTMATTER = /^---\n([\s\S]+?)\n---/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const targets = walk('memory-bank');

const converted = [];
const alreadyOk = [];
const failed = [];

for (const file of targets) {
  const original = fs.readFileSync(file, 'utf8');

  // Already readable by the framework — leave it strictly alone.
  if (FRONTMATTER.test(original)) {
    alreadyOk.push(file);
    continue;
  }

  // Not readable. Convert CRLF to LF and try again.
  const convertedText = original.replace(/\r\n/g, '\n');

  const match = convertedText.match(FRONTMATTER);
  if (!match) {
    // It has no frontmatter at all, or has some other shape. Leave it.
    failed.push({ file, reason: 'no frontmatter even after conversion' });
    continue;
  }

  try {
    yaml.load(match[1]);
  } catch (e) {
    failed.push({ file, reason: `YAML error: ${e.message}` });
    continue;
  }

  fs.writeFileSync(file, convertedText, 'utf8');
  converted.push(file);
}

console.log(`files inspected      : ${targets.length}`);
console.log(`already LF-readable  : ${alreadyOk.length}`);
console.log(`converted to LF      : ${converted.length}`);
console.log(`left alone (no frontmatter): ${failed.length}`);

if (converted.length) {
  console.log('\n--- converted ---');
  for (const f of converted) console.log('  ' + f);
}

if (failed.length) {
  console.log('\n--- left alone ---');
  for (const { file, reason } of failed) console.log(`  ${file}  (${reason})`);
}

// ── Verify: EVERY file that has frontmatter must now be readable ──
console.log('\n--- verification pass ---');
let unreadable = 0;
for (const file of walk('memory-bank')) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.startsWith('---')) continue; // genuinely has no frontmatter
  if (!FRONTMATTER.test(content)) {
    console.log(`  STILL UNREADABLE: ${file}`);
    unreadable++;
  }
}
console.log(
  unreadable === 0
    ? '  OK — every file with frontmatter is now readable by the framework.'
    : `  ${unreadable} file(s) remain unreadable.`,
);
process.exit(unreadable === 0 ? 0 : 1);
