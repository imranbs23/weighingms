/**
 * Normalise FR references in the story files to the "BRD FR-xx" convention.
 *
 * Why this exists
 * ---------------
 * WeighingMS carries two different sets of functional requirements:
 *
 *   OURS  (requirements.md)  FR-1  .. FR-23   (no leading zero)
 *   BRD   (docs/brief.md)    FR-01 .. FR-37   (zero-padded)
 *
 * The two numbering ranges OVERLAP (both contain 1..23), so a bare padded
 * "FR-13" is ambiguous: is it the BRD's FR-13 or ours? requirements.md
 * resolves this by always writing "BRD FR-13" for the BRD's set.
 *
 * The rule applied here
 * ---------------------
 *   - A zero-padded reference  FR-NN  is ALWAYS the BRD's  -> "BRD FR-NN"
 *   - An unpadded reference    FR-n   is ALWAYS ours       -> left alone
 *
 * Why this is a single pass
 * --------------------------
 * An earlier version ran two regex passes; the second consumed the digits of
 * references the first had already rewritten, leaving dangling "BRD FR-"
 * tokens. Here every already-prefixed reference is swapped for an opaque
 * sentinel FIRST, the bare-padded rewrite runs, and the sentinels are
 * restored LAST. The ordering problem cannot recur.
 *
 * The sentinel is a string that cannot occur in the source documents.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = path.join(
  ROOT,
  'memory-bank/intents/001-assisted-dyestuff-weighing-station'
);

// SCOPE — story files ONLY.
//
// This script is deliberately NOT allowed to touch units.md, the unit
// briefs, requirements.md, system-context.md or ui-analysis.md. Those
// documents already use the convention correctly, and an earlier version of
// this script rewrote OUR OWN unpadded FR-10..FR-23 as "BRD FR-10" because
// they happened to be two digits long. The rewrite rule below can only tell
// "FR-13" (BRD) from "FR-13" (ours) by the padding, and the padding is only
// unambiguous inside documents whose requirement set IS the BRD's.
//
// The story files are the only place where the two sets genuinely collide,
// because a story cites both.
const STORY_DIR = path.join(INTENT, 'units');

const OPEN = '~~POKU_PROTECTED_'; // sentinel prefix
const CLOSE = '~~';

// Matches any already-prefixed reference we must not touch:
//   "BRD FR-13", "BRD BR-03", "BRD IR-07", "BRD NFR-16",
//   "NFR-1", "AC-03", "C-07", "A-01", "Q-01", "PQ-01", "CQ-01"
//
// NOTE: "BRD FR-13" is matched as ONE token by the leading alternation, and
// a BARE "FR-13" is deliberately NOT matched here — it is the case we want
// to rewrite. Making "BRD" optional in this pattern would swallow bare
// references before the rewrite could see them, which is the bug that made
// an earlier version of this script a no-op.
const PROTECTED = /\b(?:BRD\s+(?:FR|BR|IR|NFR)-\d+|(?:NFR|AC|C|A|Q|PQ|CQ)-\d+)\b/g;

let scanned = 0;
let changed = 0;

function fixFile(p) {
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  // Step 1 — protect already-prefixed references.
  const held = [];
  s = s.replace(PROTECTED, (m) => {
    held.push(m);
    return `${OPEN}${held.length - 1}${CLOSE}`;
  });

  // Step 2 — a bare FR reference is the BRD's only when it falls outside our
  //           own range (FR-1 .. FR-23). Our own FR-10..FR-23 are two digits
  //           too, so shape alone cannot tell them apart; only the number can.
  s = s.replace(
    /(^|[^A-Za-z0-9-])FR-(\d{2})(?![0-9])/g,
    (match, lead, num) => {
      const n = Number(num);
      if (n >= 24 && n <= 37) return `${lead}BRD FR-${num}`;
      return match;
    }
  );

  // Step 3 — restore the protected references.
  s = s.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_, i) => held[Number(i)]);

  if (s !== before) {
    fs.writeFileSync(p, s);
    return true;
  }
  return false;
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && /[\\/]stories[\\/]/.test(p)) {
      scanned++;
      if (fixFile(p)) changed++;
    }
  }
}

walk(STORY_DIR);

console.log(`scanned ${scanned} story files, changed ${changed}`);
