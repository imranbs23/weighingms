// Verifies the requirements artifact covers every area the workbook specified,
// and that each requirement is traceable to a source (BRD or prototype).
const fs = require('fs');
const path = require('path');

const REQ = path.join(
  'memory-bank', 'intents', '001-assisted-dyestuff-weighing-station', 'requirements.md'
);
const text = fs.readFileSync(REQ, 'utf8');

// The 20 areas the workbook's Step 7 requires coverage of.
// Each area lists acceptable phrasings — an area is covered if any one of its
// terms appears in the document and the named FR exists.
const REQUIRED_AREAS = [
  ['Batch queue', 'FR-1', ['batch queue']],
  ['Batch selection', 'FR-2', ['batch selection']],
  ['Recipe loading', 'FR-3', ['recipe loading', 'loads the recipe', 'recipe retrieval']],
  ['Component identification', 'FR-4', ['component identification', 'identity verification']],
  ['Dyestuff lot', 'FR-5', ['dyestuff lot', 'lot capture']],
  ['Container', 'FR-6', ['container']],
  ['Tare', 'FR-6', ['tare']],
  ['Scale selection', 'FR-7', ['scale selection']],
  ['Live weight', 'FR-8', ['live weight']],
  ['Target quantity', 'FR-8', ['target quantity']],
  ['Remaining quantity', 'FR-8', ['remaining quantity', 'still-to-weigh']],
  ['Tolerance', 'FR-9', ['tolerance']],
  ['Confirmation', 'FR-10', ['confirmation gating', 'confirmation']],
  ['Overshoot', 'FR-11', ['overshoot']],
  ['Component progression', 'FR-14', ['component progression']],
  ['Batch completion', 'FR-15', ['batch completion']],
  ['OrgaTEX write-back', 'FR-16', ['write-back']],
  ['Ticket generation', 'FR-17', ['ticket generation']],
  ['Operator traceability', 'FR-18', ['operator traceability', 'traceability']],
  ['Scale/scanner/printer failure', 'FR-19', ['scale failure', 'scanner failure', 'printer failure']],
];

const REQUIRED_SECTIONS = [
  '# Functional Requirements',
  '# Non-Functional Requirements',
  '# Confirmed Requirements',
  '# Assumptions',
  '# Unresolved Questions',
  '# Training-Only Dummy Behaviour',
  '# Constraints',
  '# Dependencies',
  '# Acceptance Criteria Trace',
];

let ok = true;

// --- Section presence ---
console.log('--- Required sections ---');
for (const s of REQUIRED_SECTIONS) {
  const present = text.includes(s);
  if (!present) ok = false;
  console.log(`${present ? 'OK  ' : 'FAIL'}  ${s}`);
}

// --- Functional requirement structure ---
const frBlocks = text.split(/^#{2,3} FR-\d+:/m).slice(1);
console.log(`\n--- Functional requirements: ${frBlocks.length} found ---`);
for (const block of frBlocks) {
  const title = block.split('\n')[0].trim();
  const hasDesc = /\*\*Description\*\*/.test(block);
  const hasAc = /\*\*Acceptance Criteria\*\*/.test(block);
  const hasPri = /\*\*Priority\*\*/.test(block);
  const hasTrace = /\*\*Traceability\*\*/.test(block);
  const complete = hasDesc && hasAc && hasPri && hasTrace;
  if (!complete) ok = false;
  console.log(`${complete ? 'OK  ' : 'FAIL'}  FR ${title.slice(0, 52).padEnd(52)} desc:${hasDesc ? 'y' : 'n'} ac:${hasAc ? 'y' : 'n'} pri:${hasPri ? 'y' : 'n'} trace:${hasTrace ? 'y' : 'n'}`);
}

// --- Workbook's 20 required areas ---
console.log('\n--- Workbook Step 7 area coverage ---');
for (const [area, fr, terms] of REQUIRED_AREAS) {
  // The area must be covered by one of its terms AND the named FR must exist.
  const lower = text.toLowerCase();
  const areaMentioned = terms.some((t) => lower.includes(t.toLowerCase()));
  const frExists = new RegExp(`^#{2,3} ${fr}:`, 'm').test(text);
  const covered = areaMentioned && frExists;
  if (!covered) ok = false;
  console.log(`${covered ? 'OK  ' : 'FAIL'}  ${area.padEnd(28)} -> ${fr}`);
}

// --- NFR metrics ---
const nfrRows = text.split('\n').filter((l) => /^\|.*\|.*\|.*\| BRD NFR|^\|.*\|.*\|.*\| BRD §/.test(l));
console.log(`\n--- NFR rows with a target column: ${nfrRows.length} ---`);

// --- Separation checks ---
console.log('\n--- Separation of categories ---');
const checks = [
  ['Confirmed requirements section', '# Confirmed Requirements'],
  ['Assumptions section', '# Assumptions'],
  ['Unresolved questions section', '# Unresolved Questions'],
  ['Training-only section', '# Training-Only Dummy Behaviour'],
];
for (const [label, marker] of checks) {
  const present = text.includes(marker);
  if (!present) ok = false;
  console.log(`${present ? 'OK  ' : 'FAIL'}  ${label}`);
}

// --- Dummy API count ---
const dummyCount = (text.match(/\*\*Dummy (OrgaTEX|Scale|Scanner|Printer)\*\*/g) || []).length;
console.log(`\n--- Dummy APIs documented: ${dummyCount}/4 ---`);
if (dummyCount < 4) ok = false;

// --- Assumption IDs carried ---
const assumptionIds = ['A-01','A-02','A-03','A-04','A-05','A-06','A-07','A-08','A-09','A-10','A-11','A-12','A-13','A-14','A-15'];
const missingAssumptions = assumptionIds.filter((a) => !text.includes(a));
console.log(`--- BRD assumption IDs present: ${assumptionIds.length - missingAssumptions.length}/15 ---`);
if (missingAssumptions.length) {
  console.log(`     missing: ${missingAssumptions.join(', ')}`);
}

// --- Acceptance criteria coverage ---
const acIds = Array.from({length: 14}, (_, i) => `AC-${String(i + 1).padStart(2, '0')}`);
const missingAc = acIds.filter((a) => !text.includes(`| ${a} |`));
console.log(`--- AC rows present: ${acIds.length - missingAc.length}/14 ---`);
if (missingAc.length) {
  console.log(`     missing: ${missingAc.join(', ')}`);
  ok = false;
}

console.log(ok ? '\nALL REQUIREMENT CHECKS PASSED' : '\nREQUIREMENT CHECKS FAILED');
process.exit(ok ? 0 : 1);
