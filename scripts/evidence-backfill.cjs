/**
 * Backfilled workbook evidence — Steps 13 to 27.
 *
 *   node scripts/evidence-backfill.cjs <step>      e.g. 13
 *
 * These steps were carried out during construction (bolts 001–029) but
 * their evidence files were never saved. This script captures them NOW,
 * from the project's own records (the memory bank, the code, the running
 * product), and every artefact says so in its header: it is a backfill,
 * captured on the date it is run, not a screenshot from the day the step
 * happened.
 *
 * Each step writes `evidence/STEP-NN-*.md` (the record) and renders it to
 * the PNG the workbook names, with Playwright.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'evidence');
const BOLTS = path.join(ROOT, 'memory-bank', 'bolts');
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Reading the memory bank.
// ---------------------------------------------------------------------------

/** Every bolt, in id order, with its frontmatter and its overview line. */
function readBolts() {
  return fs
    .readdirSync(BOLTS)
    .filter((name) => fs.existsSync(path.join(BOLTS, name, 'bolt.md')))
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(BOLTS, name, 'bolt.md'), 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const front = match ? yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) : {};
      // The overview's first PARAGRAPH — it may wrap over several lines.
      const overview = /## Overview\s*\r?\n\s*\r?\n([\s\S]*?)(?:\r?\n\s*\r?\n|$)/.exec(text);
      return {
        ...front,
        description: overview ? overview[1].replace(/\s+/g, ' ').trim() : '',
      };
    });
}

/** The bolts that may run now: not complete, every required bolt complete. */
function nextExecutable(bolts) {
  const done = new Set(bolts.filter((b) => b.status === 'complete').map((b) => b.id));
  return bolts.filter(
    (b) =>
      b.status !== 'complete' &&
      (b.requires_bolts ?? []).every((id) => done.has(id)),
  );
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

const PAGE_STYLE = `
  body { margin: 0; padding: 28px 32px; background: #0f1720; color: #e6edf5;
         font: 14px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #9fb0c4; margin-bottom: 18px; }
  .note { border-left: 3px solid #ffc857; padding: 6px 12px; color: #c9d4e0;
          background: #1a2430; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid #253244; padding: 6px 8px; text-align: left;
           vertical-align: top; }
  th { color: #9fb0c4; font-weight: 600; text-transform: uppercase;
       font-size: 11px; letter-spacing: .04em; }
  td.mono { font-family: Consolas, monospace; white-space: nowrap; }
  td.desc { width: 46%; }
  .ok { color: #5fd08a; } .warn { color: #ffc857; }
  .foot { margin-top: 16px; color: #9fb0c4; }
`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function renderPng(html, file) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
}

// ---------------------------------------------------------------------------
// The steps.
// ---------------------------------------------------------------------------

const STEPS = {
  /** STEP 13 — List the Bolts. */
  async 13() {
    const bolts = readBolts();
    const next = nextExecutable(bolts);
    const typeLabel = (type) =>
      type === 'ddd-construction-bolt' ? 'DDD' : type === 'simple-construction-bolt' ? 'Simple' : type;

    const rows = bolts.map((b) => ({
      id: b.id,
      unit: b.unit,
      description: b.description,
      type: typeLabel(b.type),
      requires: (b.requires_bolts ?? []).join(', ') || '—',
      status: b.status,
    }));

    const nextText =
      next.length === 0
        ? 'None — every bolt is complete.'
        : next.map((b) => b.id).join(', ');
    const firstRunnable = bolts.filter((b) => (b.requires_bolts ?? []).length === 0);

    const md = [
      '---',
      'step: 13',
      `captured: ${TODAY}`,
      'backfill: true',
      'source: memory-bank/bolts/*/bolt.md',
      '---',
      '',
      '# Step 13 — List the Bolts',
      '',
      '> **Backfilled evidence.** The bolt list was produced by the Construction',
      '> Agent at the start of construction, but no screenshot was saved then.',
      `> This list is regenerated on ${TODAY} from the bolts' own frontmatter by`,
      '> `node scripts/evidence-backfill.cjs 13`, so the statuses are today\'s.',
      '',
      `**${bolts.length} bolts**, ${bolts.filter((b) => b.status === 'complete').length} complete.`,
      '',
      '| Bolt ID | Unit | Description | Type | Depends on | Status |',
      '|---|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.id} | ${r.unit} | ${r.description.replace(/\|/g, '\\|')} | ${r.type} | ${r.requires} | ${r.status} |`,
      ),
      '',
      `**Next executable bolt:** ${nextText}`,
      '',
      `At the start of construction the executable bolts were those with no`,
      `dependencies: ${firstRunnable.map((b) => '`' + b.id + '`').join(', ')}.`,
      'Construction began with `001-008-operator-identity` (Step 14).',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-13-bolt-list.md'), md);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body>
      <h1>WeighingMS — Bolts</h1>
      <div class="sub">/specsmd-construction-agent · List all WeighingMS Bolts · ${bolts.length} bolts</div>
      <p class="note">Backfilled evidence, regenerated ${TODAY} from memory-bank/bolts/*/bolt.md. Statuses are as of today.</p>
      <table>
        <thead><tr><th>Bolt ID</th><th>Unit</th><th>Description</th><th>Type</th><th>Depends on</th><th>Status</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr><td class="mono">${escapeHtml(r.id)}</td><td class="mono">${escapeHtml(r.unit)}</td>
              <td class="desc">${escapeHtml(r.description)}</td><td>${escapeHtml(r.type)}</td>
              <td class="mono">${escapeHtml(r.requires).replace(/, /g, '<br>')}</td>
              <td class="${r.status === 'complete' ? 'ok' : 'warn'}">${escapeHtml(r.status)}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
      <p class="foot"><b>Next executable bolt:</b> ${escapeHtml(nextText)}<br>
      At the start of construction: ${escapeHtml(firstRunnable.map((b) => b.id).join(', '))} (no dependencies).</p>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-13-bolt-list.png'));
    return ['evidence/STEP-13-bolt-list.md', 'evidence/STEP-13-bolt-list.png'];
  },

  /** STEP 14 — Start the First Bolt. */
  async 14() {
    const BOLT = '001-008-operator-identity';
    const UNIT = '008-operator-identity';
    const PLANNED_IN = 'b2d54fe';
    const STARTED_IN = '47f5883';
    const command = `/specsmd-construction-agent --unit="${UNIT}" --bolt-id="${BOLT}"`;

    // THE BOLT AS IT WAS BEFORE IT STARTED — from git, not from today's file.
    const planned = git(`show ${PLANNED_IN}:memory-bank/bolts/${BOLT}/bolt.md`);
    const plannedFront = /^---\r?\n([\s\S]*?)\r?\n---/.exec(planned)[1];
    const log = fs.readFileSync(
      path.join(ROOT, 'memory-bank', 'intents', '001-assisted-dyestuff-weighing-station',
        'units', UNIT, 'construction-log.md'),
      'utf8',
    );
    const startLine = log.split(/\r?\n/).find((line) => line.includes(`\`${BOLT}\` started`));
    const plannedCommit = git(`log -1 --format=%h·%ad·%s --date=iso ${PLANNED_IN}`).trim();
    const startedCommit = git(`log -1 --format=%h·%ad·%s --date=iso ${STARTED_IN}`).trim();

    const md = [
      '---',
      'step: 14',
      `captured: ${TODAY}`,
      'backfill: true',
      `source: git ${PLANNED_IN} and ${STARTED_IN}; units/${UNIT}/construction-log.md`,
      '---',
      '',
      '# Step 14 — Start the First Bolt',
      '',
      '> **Backfilled evidence.** The bolt was started on 2026-10-30; no',
      `> screenshot was saved. This page is regenerated on ${TODAY} from git and`,
      '> the unit\'s construction log by `node scripts/evidence-backfill.cjs 14`.',
      '',
      '## The command, with the exact names the project generated',
      '',
      '```text',
      command,
      '```',
      '',
      `- **Unit:** \`${UNIT}\``,
      `- **Bolt:** \`${BOLT}\` (DDD construction bolt, story \`001-sign-in-at-terminal\`)`,
      '- **Why first:** it has no dependencies, it is first in id order, and every',
      '  other unit\'s privileged action depends on the operator\'s identity.',
      '',
      `## The bolt before it started (\`git show ${PLANNED_IN}\`)`,
      '',
      '```yaml',
      plannedFront,
      '```',
      '',
      '## The start, as recorded',
      '',
      `- Construction log: ${startLine.replace(/^-\s*/, '')}`,
      `- Planned in: \`${plannedCommit}\``,
      `- Built in: \`${startedCommit}\``,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-14-bolt-start.md'), md);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      pre { background: #0b1118; border: 1px solid #253244; padding: 12px 14px;
            font: 13px/1.5 Consolas, monospace; white-space: pre-wrap; margin: 0 0 16px; }
      .cmd { color: #5fd08a; font-size: 15px; }
      h2 { font-size: 15px; margin: 18px 0 8px; color: #c9d4e0; }
      li { margin: 3px 0; } code { font-family: Consolas, monospace; color: #ffc857; }
    </style></head><body>
      <h1>WeighingMS — Start the first bolt</h1>
      <div class="sub">Construction Agent · workbook Step 14</div>
      <p class="note">Backfilled evidence, regenerated ${TODAY} from git (${PLANNED_IN}, ${STARTED_IN}) and the unit's construction log.</p>
      <pre class="cmd">${escapeHtml(command)}</pre>
      <ul>
        <li><b>Unit:</b> <code>${UNIT}</code></li>
        <li><b>Bolt:</b> <code>${BOLT}</code> — DDD construction bolt, story <code>001-sign-in-at-terminal</code></li>
        <li><b>Why first:</b> no dependencies, first in id order, and every privileged action in the other units depends on the operator's identity.</li>
      </ul>
      <h2>The bolt before it started — git show ${PLANNED_IN}</h2>
      <pre>${escapeHtml(plannedFront)}</pre>
      <h2>The start, as recorded</h2>
      <ul>
        <li>Construction log: ${escapeHtml(startLine.replace(/^-\s*/, '').replace(/\*\*/g, '').replace(/`/g, ''))}</li>
        <li>Planned in: <code>${escapeHtml(plannedCommit)}</code></li>
        <li>Built in: <code>${escapeHtml(startedCommit)}</code></li>
      </ul>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-14-bolt-start.png'));
    return ['evidence/STEP-14-bolt-start.md', 'evidence/STEP-14-bolt-start.png'];
  },

  /** STEP 15 — Execute the Bolt Plan Stage (bolt 001: model + design). */
  async 15() {
    const BOLT = '001-008-operator-identity';
    const dir = `memory-bank/bolts/${BOLT}`;
    // The five answers the workbook asks for, each drawn from the bolt's own
    // Stage 1 and Stage 2 artefacts, with the section it came from.
    const answers = [
      {
        q: '1. What will change?',
        a: [
          'A new bounded context, Operator Identity: who is this, what may they do, have they proved it.',
          'Entities Operator, Credential, IdentitySession; a local IdentityProvider behind a seam (Q-08 undecided).',
          'Credentials stored only as a memory-hard hash (Argon2id); session tokens opaque, stored as digests.',
          'Signing in grants no supervisor privilege (that is bolt 002).',
        ],
        src: 'ddd-01-domain-model.md § Bounded Context',
      },
      {
        q: '2. Which files will be created / modified?',
        a: [
          'src/008-operator-identity/domain/ — entities, value objects, services, ports (no runtime deps)',
          'src/008-operator-identity/application/use-cases/ — sign-in, sign-out, get-current-operator',
          'src/008-operator-identity/infrastructure/ — SQLite repositories, Argon2 hasher, token generator',
          'src/008-operator-identity/presentation/ — identity controller, require-operator middleware, Zod schemas',
          'src/api/ — the Express app the controller mounts on',
        ],
        src: 'ddd-02-technical-design.md § Layer Structure',
      },
      {
        q: '3. Which requirements and stories?',
        a: [
          'Story 001-sign-in-at-terminal (10 acceptance criteria).',
          'FR-18 (the operator on every weighing), FR-21 (no privilege from sign-in).',
          'BRD FR-25, FR-34, FR-35, AC-07, NFR-12 (credential security).',
        ],
        src: 'stories/001-sign-in-at-terminal.md; ddd-01 § Story Coverage',
      },
      {
        q: '4. Which APIs are involved?',
        a: [
          'POST /api/identity/sign-in — { operatorId, secret } → token, sessionId, operator, expiresAt',
          'POST /api/identity/sign-out — ends the session, idempotent',
          'GET /api/identity/current — the current operator, or 401',
          'GET /api/identity/session — the session facts, or 401',
          'No Dummy OrgaTEX / scale / printer API: identity is local.',
        ],
        src: 'ddd-02-technical-design.md § API Design',
      },
      {
        q: '5. How will this be tested?',
        a: [
          'Unit tests (Vitest) on the domain: session expiry at the boundary, the closed role set, the opaque token.',
          'API integration tests (supertest) for each endpoint, including 401 without a session.',
          'A constant-work timing test: an unknown operator and a wrong secret take the same time class.',
          'A check that no plaintext secret reaches the store or a log.',
        ],
        src: 'ddd-02-technical-design.md § Security Design, § External Dependencies; run in Stage 5 (ddd-03-test-report.md)',
      },
    ];

    const designCommit = git(
      `log -1 --format=%h·%ad·%s --date=iso -- ${dir}/ddd-02-technical-design.md`,
    ).trim();
    const stages = yaml
      .load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(ROOT, dir, 'bolt.md'), 'utf8'))[1],
        { schema: yaml.JSON_SCHEMA })
      .stages_completed.filter((stage) => stage.name === 'model' || stage.name === 'design');

    const md = [
      '---',
      'step: 15',
      `captured: ${TODAY}`,
      'backfill: true',
      `source: ${dir}/ddd-01-domain-model.md, ddd-02-technical-design.md`,
      '---',
      '',
      '# Step 15 — Execute the Bolt Plan Stage',
      '',
      '> **Backfilled evidence.** Bolt `001-008-operator-identity` is a DDD',
      '> construction bolt, so its planning stages are **Model** and **Design**',
      '> (then ADR, Implement, Test). Their artefacts are the plan; this page',
      `> answers the workbook's five questions from them, regenerated on ${TODAY}.`,
      '',
      ...answers.flatMap((entry) => [
        `## ${entry.q}`,
        '',
        ...entry.a.map((line) => `- ${line}`),
        '',
        `*Source: ${entry.src}*`,
        '',
      ]),
      '## The checkpoint',
      '',
      ...stages.map((stage) => `- Stage **${stage.name}** completed ${stage.completed} → \`${stage.artifact}\``),
      '',
      `The plan artefacts were committed together with the implementation, in`,
      `\`${designCommit}\`, so git holds no separate "planned, not yet built"`,
      'snapshot of this bolt. The stages and their human approvals are recorded',
      'in the bolt file and the unit\'s construction log.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-15-plan.md'), md);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .card { background: #141d28; border: 1px solid #253244; padding: 12px 16px; }
      .card h2 { font-size: 15px; margin: 0 0 6px; color: #ffc857; }
      .card ul { margin: 0; padding-left: 18px; } .card li { margin: 3px 0; }
      .src { color: #9fb0c4; font-size: 12px; margin-top: 6px; font-style: italic; }
      .stop { border: 1px solid #5fd08a; color: #5fd08a; padding: 8px 12px; margin-top: 14px; }
    </style></head><body>
      <h1>Bolt 001-008-operator-identity — Plan</h1>
      <div class="sub">DDD construction bolt · Model → Design → ADR → Implement → Test · workbook Step 15</div>
      <p class="note">Backfilled evidence, regenerated ${TODAY} from the bolt's Stage 1 and Stage 2 artefacts. "Do not implement yet": the plan is the model and the design.</p>
      <div class="grid">${answers
        .map(
          (entry) => `<div class="card"><h2>${escapeHtml(entry.q)}</h2><ul>${entry.a
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join('')}</ul><div class="src">${escapeHtml(entry.src)}</div></div>`,
        )
        .join('')}
        <div class="card"><h2>Human validation checkpoint</h2><ul>${stages
          .map((stage) => `<li>${escapeHtml(stage.name)} completed ${escapeHtml(stage.completed)} → ${escapeHtml(stage.artifact)}</li>`)
          .join('')}</ul>
          <div class="src">Plan and implementation share commit ${escapeHtml(designCommit)} — no separate plan-only snapshot in git.</div></div>
      </div>
      <div class="stop">⛔ Stop at the checkpoint — implementation (Stage 4) waits for approval.</div>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-15-plan.png'));
    return ['evidence/STEP-15-plan.md', 'evidence/STEP-15-plan.png'];
  },

  /**
   * STEP 16 — Build the Dummy Integration Layer.
   *
   * The workbook names no evidence file for this step, but it names the
   * endpoints. Each read is probed LIVE against the running API; each write
   * is located in the code rather than called, so the probe changes nothing.
   */
  async 16() {
    const token = await signIn('OP-002', '7359');
    const reads = [
      { group: 'Dummy OrgaTEX', path: '/api/batches', required: 'GET /api/batches' },
      { group: 'Dummy OrgaTEX', path: '/api/batches/B-24187', required: 'GET /api/batches/:batchId' },
      { group: 'Dummy OrgaTEX', path: '/api/batches/B-24187/recipe', required: 'GET /api/batches/:batchId/recipe' },
      { group: 'Dummy Scale', path: '/api/scales', required: 'GET /api/scales' },
      { group: 'Dummy Scale', path: '/api/scales/SCALE-A/status', required: 'GET /api/scales/:scaleId/status' },
      { group: 'Dummy Scale', path: '/api/scales/SCALE-A/weight', required: 'GET /api/scales/:scaleId/weight', stream: true },
      { group: 'Dummy Scanner', path: '/api/scanner/status', required: '(not named)' },
      { group: 'Dummy Printer', path: '/api/printer/status', required: '(not named)' },
    ];
    const writes = [
      { group: 'Dummy OrgaTEX', required: 'POST /api/batches/:batchId/consumption', file: 'src/005-orgatex-integration/presentation/controllers/dummy-orgatex-controller.ts', pattern: "'/batches/:batchId/consumption'" },
      { group: 'Dummy Scale', required: 'POST /api/scales/:scaleId/tare', file: 'src/004-scale-integration/presentation/controllers/scale-controller.ts', pattern: "router.post('/:scaleId/tare'" },
      { group: 'Dummy Printer', required: 'POST /api/tickets', file: 'src/006-ticket-printing/presentation/controllers/ticket-controller.ts', pattern: "router.post('/'" },
      { group: 'Dummy Scanner', required: '(not named) a scan: POST /api/selection { code }', file: 'src/001-batch-management/presentation/controllers/batch-selection-controller.ts', pattern: "router.post('/'" },
    ];

    for (const read of reads) {
      const outcome = await probe(read.path, token, read.stream === true);
      read.status = outcome.status;
      read.sample = outcome.sample;
    }
    for (const write of writes) {
      const lines = fs.readFileSync(path.join(ROOT, write.file), 'utf8').split(/\r?\n/);
      const index = lines.findIndex((line) => line.includes(write.pattern));
      write.where = index < 0 ? 'NOT FOUND' : `${write.file}:${index + 1}`;
    }

    const md = [
      '---',
      'step: 16',
      `captured: ${TODAY}`,
      'backfill: true',
      `source: live probe of ${API_URL}; route definitions in src/`,
      '---',
      '',
      '# Step 16 — Build the Dummy Integration Layer',
      '',
      '> **Backfilled evidence.** The workbook names no file for this step; it',
      '> names the endpoints. Each read below was called on the running API on',
      `> ${TODAY}; each write is located in the code and NOT called, so this`,
      '> check changes no data.',
      '',
      '> These are **training contracts**, not claims about the real OrgaTEX',
      '> interface. The brief\'s open integration questions stay open.',
      '',
      '## Reads — probed live',
      '',
      '| Service | Workbook endpoint | Probed | Status | First bytes of the answer |',
      '|---|---|---|---|---|',
      ...reads.map((r) => `| ${r.group} | ${r.required} | \`GET ${r.path}\` | ${r.status} | \`${r.sample.replace(/\|/g, '\\|')}\` |`),
      '',
      '## Writes — located in the code, not called',
      '',
      '| Service | Workbook endpoint | Defined at |',
      '|---|---|---|',
      ...writes.map((w) => `| ${w.group} | ${w.required} | \`${w.where}\` |`),
      '',
      'Their behaviour is exercised by the integration suite and by the Step 29',
      'and Step 30 end-to-end runs.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-16-dummy-apis.md'), md);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      h2 { font-size: 15px; margin: 18px 0 8px; color: #c9d4e0; }
      td.sample { font-family: Consolas, monospace; font-size: 11.5px; color: #9fb0c4; word-break: break-all; }
    </style></head><body>
      <h1>WeighingMS — Dummy integration layer</h1>
      <div class="sub">Dummy OrgaTEX · Dummy Scale · Dummy Scanner · Dummy Printer · workbook Step 16</div>
      <p class="note">Backfilled evidence, ${TODAY}. Reads probed live against ${escapeHtml(API_URL)}; writes located in the code and not called. Training contracts — not claims about the real OrgaTEX interface.</p>
      <h2>Reads — probed live</h2>
      <table><thead><tr><th>Service</th><th>Workbook endpoint</th><th>Probed</th><th>Status</th><th>First bytes of the answer</th></tr></thead><tbody>
      ${reads.map((r) => `<tr><td>${escapeHtml(r.group)}</td><td class="mono">${escapeHtml(r.required)}</td><td class="mono">GET ${escapeHtml(r.path)}</td>
        <td class="${r.status === 200 ? 'ok' : 'warn'}">${r.status}</td><td class="sample">${escapeHtml(r.sample)}</td></tr>`).join('')}
      </tbody></table>
      <h2>Writes — located in the code, not called</h2>
      <table><thead><tr><th>Service</th><th>Workbook endpoint</th><th>Defined at</th></tr></thead><tbody>
      ${writes.map((w) => `<tr><td>${escapeHtml(w.group)}</td><td class="mono">${escapeHtml(w.required)}</td><td class="mono">${escapeHtml(w.where)}</td></tr>`).join('')}
      </tbody></table>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-16-dummy-apis.png'));
    return ['evidence/STEP-16-dummy-apis.md', 'evidence/STEP-16-dummy-apis.png'];
  },

  /**
   * STEP 17 — Seed the Dummy Data.
   *
   * The JSON is what the Dummy APIs SERVE (read live), not a hand-copied
   * fixture, and every component is checked against the supplied prototype.
   */
  async 17() {
    const token = await signIn('OP-002', '7359');
    const get = async (apiPath) => {
      const response = await fetch(`${API_URL}${apiPath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json();
    };
    const batch = await get('/api/batches/B-24187');
    const recipe = await get('/api/batches/B-24187/recipe');
    const { scales } = await get('/api/scales');

    // THE PROTOTYPE'S OWN SCENARIO — its component array, as FCI supplied it.
    const prototype = fs.readFileSync(path.join(ROOT, 'docs', 'customize-weighing-station.html'), 'utf8');
    const protoRows = [...prototype.matchAll(/\{ id: "([^"]+)",\s*name: "([^"]+)",\s*code: "([^"]+)",[^}]*?target: ([\d.]+),\s*unit: "(\w+)",\s*tol: ([\d.]+),\s*scale: "([^"]+)"/g)]
      .map((m) => ({ id: m[1], name: m[2], code: m[3], target: m[4], unit: m[5], tol: m[6], scale: m[7] }));

    const scaleLabel = (scaleClass) =>
      scales.find((scale) => scale.class === scaleClass)?.label ?? scaleClass;
    const decimal = (text) => Number(text); // display comparison only
    const comparison = recipe.components.map((component) => {
      const proto = protoRows.find((row) => row.id === component.componentId);
      const halfWidth = (decimal(component.toleranceMax) - decimal(component.toleranceMin)) / 2;
      const checks = proto === undefined ? null : {
        name: proto.name === component.name,
        code: proto.code === component.dyestuffCode,
        target: decimal(proto.target) === decimal(component.target),
        unit: proto.unit === component.unit,
        tolerance: Math.abs(decimal(proto.tol) - halfWidth) < 1e-9,
        scale: proto.scale === scaleLabel(component.scaleClass),
      };
      return { component, proto, halfWidth, checks, match: checks !== null && Object.values(checks).every(Boolean) };
    });

    const data = {
      _evidence: {
        step: 17,
        captured: TODAY,
        backfill: true,
        source: `live answers of the Dummy APIs at ${API_URL}`,
        seededFrom: 'src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.ts',
        note: 'Training data from the supplied prototype; not a claim about the real OrgaTEX data.',
        matchesPrototype: comparison.every((entry) => entry.match),
      },
      batch,
      recipe,
      scales,
    };
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-17-dummy-data.json'), `${JSON.stringify(data, null, 2)}\n`);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      h2 { font-size: 15px; margin: 18px 0 8px; color: #c9d4e0; }
      .cols { display: grid; grid-template-columns: 1fr 1.35fr; gap: 18px; }
      pre { background: #0b1118; border: 1px solid #253244; padding: 12px 14px; margin: 0;
            font: 12px/1.45 Consolas, monospace; white-space: pre-wrap; }
      .url { color: #5fd08a; font: 13px Consolas, monospace; margin-bottom: 6px; }
    </style></head><body>
      <h1>WeighingMS — Dummy data: ${escapeHtml(batch.batchId)}</h1>
      <div class="sub">Order ${escapeHtml(batch.orderRef)} · Machine ${escapeHtml(batch.machineRef)} · Shade ${escapeHtml(batch.shadeCode)} · workbook Step 17</div>
      <p class="note">Backfilled evidence, ${TODAY}: the live answers of the Dummy OrgaTEX and Dummy Scale APIs, checked against the supplied prototype. Training data, not a claim about the real OrgaTEX.</p>
      <div class="cols">
        <div>
          <div class="url">GET ${escapeHtml(API_URL)}/api/batches/B-24187 → 200</div>
          <pre>${escapeHtml(JSON.stringify(batch, null, 2))}</pre>
          <h2>Scales — GET /api/scales</h2>
          <pre>${escapeHtml(scales.map((s) => `${s.scaleId}  ${s.label.padEnd(15)} ${s.class.padEnd(9)} capacity ${s.capacity} ${s.unit}  ${s.status}`).join('\n'))}</pre>
        </div>
        <div>
          <div class="url">GET ${escapeHtml(API_URL)}/api/batches/B-24187/recipe → 200</div>
          <pre>${escapeHtml(JSON.stringify(recipe, null, 1).slice(0, 2600))}${JSON.stringify(recipe, null, 1).length > 2600 ? '\n…' : ''}</pre>
        </div>
      </div>
      <h2>Against the supplied prototype (docs/customize-weighing-station.html)</h2>
      <table><thead><tr><th>#</th><th>Component</th><th>Code</th><th>Target</th><th>Tolerance</th><th>Scale</th><th>Prototype</th></tr></thead><tbody>
      ${comparison.map(({ component, proto, halfWidth, match }) => `<tr>
        <td>${component.sequence}</td><td>${escapeHtml(component.name)}</td><td class="mono">${escapeHtml(component.dyestuffCode)}</td>
        <td class="mono">${escapeHtml(component.target)} ${escapeHtml(component.unit)}</td>
        <td class="mono">± ${halfWidth.toFixed(3)} (${escapeHtml(component.toleranceMin)} – ${escapeHtml(component.toleranceMax)})</td>
        <td>${escapeHtml(scaleLabel(component.scaleClass))}</td>
        <td class="${match ? 'ok' : 'warn'}">${match ? 'matches' : proto === undefined ? 'not in prototype' : 'DIFFERS'}${proto ? ` (${escapeHtml(proto.target)} ${escapeHtml(proto.unit)} ± ${escapeHtml(proto.tol)}, ${escapeHtml(proto.scale)})` : ''}</td></tr>`).join('')}
      </tbody></table>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-17-api-response.png'));

    const mismatches = comparison.filter((entry) => !entry.match).map((entry) => entry.component.componentId);
    console.log(mismatches.length === 0 ? 'all five components match the prototype' : `MISMATCH: ${mismatches.join(', ')}`);
    return ['evidence/STEP-17-dummy-data.json', 'evidence/STEP-17-api-response.png'];
  },

  /**
   * STEP 18 — Test the Dummy APIs.
   *
   * Two parts: the workbook's own curl calls against the running API (the
   * actual port), and the automated suites for the same APIs.
   */
  async 18() {
    const { execFileSync, spawnSync } = require('child_process');
    const curl = (args) => {
      try {
        return execFileSync('curl', ['-s', '--max-time', '5', ...args], { encoding: 'utf8' });
      } catch (error) {
        return error.stdout ?? String(error);
      }
    };
    const token = await signIn('OP-002', '7359');

    // THE WORKBOOK'S CALLS — the three it names, then the rest of the layer.
    const calls = [
      { path: '/api/batches', auth: false },
      { path: '/api/batches/B-24187', auth: false },
      { path: '/api/batches/B-24187/recipe', auth: false },
      { path: '/api/scales', auth: true },
      { path: '/api/scales/SCALE-A/status', auth: true },
      { path: '/api/scanner/status', auth: true },
      { path: '/api/printer/status', auth: true },
      { path: '/api/batches/B-99999', auth: false, note: 'an unknown batch is a 404, not an empty 200' },
    ];
    const transcript = calls.map((call) => {
      const shown = `curl ${call.auth ? '-H "Authorization: Bearer <token>" ' : ''}${API_URL}${call.path}`;
      const args = [...(call.auth ? ['-H', `Authorization: Bearer ${token}`] : []), '-w', '\nHTTP %{http_code}', `${API_URL}${call.path}`];
      const out = curl(args);
      const status = /HTTP (\d{3})\s*$/.exec(out)?.[1] ?? '???';
      const body = out.replace(/\nHTTP \d{3}\s*$/, '');
      let pretty = body;
      try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not JSON */ }
      return { shown, status, pretty, note: call.note };
    });

    // THE AUTOMATED SUITES for the same APIs.
    const suites = [
      'tests/integration/orgatex-api.test.ts',
      'tests/integration/orgatex-write-api.test.ts',
      'tests/integration/scale-api.test.ts',
      'tests/integration/scale-stream.test.ts',
      'tests/integration/scale-tare-api.test.ts',
      'tests/integration/ticket-api.test.ts',
      'tests/integration/terminal-workflow-api.test.ts',
    ];
    // One command string: the paths are this script's own constants.
    const run = spawnSync(`npx vitest run ${suites.join(' ')} --reporter=verbose`, {
      cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const vitest = `${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    const summary = vitest.split(/\r?\n/).filter((line) => /^\s*(Test Files|Tests)\s/.test(line)).map((line) => line.trim());

    const text = [
      `STEP 18 — Test the Dummy APIs`,
      `Captured ${new Date().toISOString()} (backfilled evidence; the APIs were first tested during bolts 003–007).`,
      `API: ${API_URL}  — the actual port of this implementation (npm run dev:api).`,
      `The token is OP-002's, from POST /api/identity/sign-in; it is not printed.`,
      '',
      '======================================================================',
      'PART 1 — curl, as the workbook asks',
      '======================================================================',
      ...transcript.flatMap((entry) => [
        '',
        `$ ${entry.shown}${entry.note ? `      # ${entry.note}` : ''}`,
        `HTTP ${entry.status}`,
        entry.pretty,
      ]),
      '',
      '======================================================================',
      'PART 2 — the automated suites for the same APIs',
      '======================================================================',
      `$ npx vitest run ${suites.join(' ')} --reporter=verbose`,
      '',
      vitest.trim(),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-18-api-tests.txt'), text);

    const testLines = vitest.split(/\r?\n/).filter((line) => /^\s*[✓×↓]/.test(line));
    const passed = testLines.filter((line) => line.trim().startsWith('✓')).length;
    const failed = testLines.filter((line) => line.trim().startsWith('×')).length;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      h2 { font-size: 15px; margin: 18px 0 8px; color: #c9d4e0; }
      .call { background: #0b1118; border: 1px solid #253244; padding: 8px 12px; margin-bottom: 8px; }
      .cmd { color: #5fd08a; font: 12.5px Consolas, monospace; }
      .res { color: #9fb0c4; font: 11.5px Consolas, monospace; white-space: pre-wrap; max-height: 64px; overflow: hidden; }
      .big { font-size: 20px; } .cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; }
      pre.t { background: #0b1118; border: 1px solid #253244; padding: 10px 12px; margin: 0;
              font: 11px/1.45 Consolas, monospace; white-space: pre-wrap; }
    </style></head><body>
      <h1>WeighingMS — Dummy API tests</h1>
      <div class="sub">workbook Step 18 · ${escapeHtml(API_URL)} · backfilled ${TODAY}</div>
      <p class="note">Backfilled evidence: the APIs were first tested during bolts 003–007. Part 1 is the workbook's curl calls on the running API; part 2 is the automated suites for the same APIs. Full output: STEP-18-api-tests.txt.</p>
      <div class="cols"><div>
        <h2>Part 1 — curl on the running API</h2>
        ${transcript.map((entry) => `<div class="call"><div class="cmd">$ ${escapeHtml(entry.shown)} → <span class="${entry.status.startsWith('2') || entry.note ? 'ok' : 'warn'}">HTTP ${entry.status}</span>${entry.note ? ` <span style="color:#9fb0c4"># ${escapeHtml(entry.note)}</span>` : ''}</div>
          <div class="res">${escapeHtml(entry.pretty.replace(/\s+/g, ' ').slice(0, 260))}</div></div>`).join('')}
      </div><div>
        <h2>Part 2 — automated suites</h2>
        <p class="big"><span class="ok">${passed} passed</span>${failed ? ` · <span class="warn">${failed} failed</span>` : ''}</p>
        <pre class="t">${escapeHtml(summary.join('\n'))}\n\n${escapeHtml(suites.join('\n'))}</pre>
        <h2>Tests (first 40)</h2>
        <pre class="t">${escapeHtml(testLines.slice(0, 40).map((line) => line.trim().replace(/\s+\d+ms$/, '')).join('\n'))}${testLines.length > 40 ? `\n… and ${testLines.length - 40} more in STEP-18-api-tests.txt` : ''}</pre>
      </div></div>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-18-api-results.png'));
    console.log(summary.join(' | '));
    return ['evidence/STEP-18-api-tests.txt', 'evidence/STEP-18-api-results.png'];
  },

  /**
   * STEP 19 — Connect Batch Selection.
   *
   * The screen and the network are captured by a Playwright spec against a
   * fresh product (playwright/evidence/step19-batch-selection.spec.ts); the
   * test evidence is its report.
   */
  async 19() {
    await runEvidenceSpec(19, 'step19');
    await shootReport(19, 'STEP-19-test.png');
    return ['evidence/STEP-19-batch-screen.png', 'evidence/STEP-19-network.png', 'evidence/STEP-19-test.png'];
  },

  /** STEP 20 — Implement the Weighing Screen (spec: step20-weigh-screen). */
  async 20() {
    await runEvidenceSpec(20, 'step20');
    return ['evidence/STEP-20-weigh-screen.png', 'evidence/STEP-20-weigh-screen.md'];
  },

  /** STEP 21 — Connect the Scale API (spec: step21-scale-switch). */
  async 21() {
    await runEvidenceSpec(21, 'step21');
    return ['evidence/STEP-21-scale-switch.png', 'evidence/STEP-21-scale-api.png'];
  },

  /**
   * STEP 22 — Implement Tolerance.
   *
   * The automated tests (the zone and the gate, including the workbook's
   * five weights) and the end-to-end run on the terminal, in one file.
   */
  async 22() {
    const { spawnSync } = require('child_process');
    const suites = ['tests/unit/tolerance-zone.test.ts', 'tests/unit/confirmation-gate.test.ts'];
    const run = spawnSync(`npx vitest run ${suites.join(' ')} --reporter=verbose`, {
      cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const vitest = `${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (run.status !== 0) throw new Error('the tolerance unit tests failed');

    await runEvidenceSpec(22, 'step22');
    const e2e = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'STEP-22-tolerance-e2e.json'), 'utf8'));
    fs.unlinkSync(path.join(EVIDENCE, 'STEP-22-tolerance-e2e.json'));

    const text = [
      'STEP 22 — Implement Tolerance',
      `Captured ${new Date().toISOString()} (backfilled evidence; tolerance was built in bolt 014).`,
      'Yellow RGB: target 94.0 g, tolerance ±0.5 g → band 93.5 g … 94.5 g, both ends inclusive.',
      '',
      '======================================================================',
      'PART 1 — the workbook\'s table, end to end on the terminal (Playwright)',
      '======================================================================',
      '$ EVIDENCE_STEP=22 npx playwright test -c playwright.evidence.config.ts step22',
      '',
      'Weight   Case              Expected         Zone   Confirm button   API confirm',
      ...e2e.map((r) =>
        `${(r.weight + ' g').padEnd(9)}${r.case.padEnd(18)}${r.expected.padEnd(17)}${r.zone.padEnd(7)}${(r.confirmEnabled ? 'enabled' : 'disabled').padEnd(17)}${r.api}`),
      '',
      'An allowed weight is not sent to the API (it would record the weighing);',
      'the gate\'s ALLOWED answer for 93.5, 94.0 and 94.5 is proved in PART 2.',
      '93.4 g is refused in the NEAR zone (just short of the band); it cannot be',
      'confirmed, which is what the workbook asks.',
      '',
      '======================================================================',
      'PART 2 — the automated unit tests: the zone and the confirmation gate',
      '======================================================================',
      `$ npx vitest run ${suites.join(' ')} --reporter=verbose`,
      '',
      vitest,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(EVIDENCE, 'STEP-22-tolerance-tests.txt'), text);
    return ['evidence/STEP-22-tolerance-tests.txt', 'evidence/STEP-22-tolerance-ui.png'];
  },

  /** STEP 23 — Implement Component Progression (spec: step23-progression). */
  async 23() {
    await runEvidenceSpec(23, 'step23');
    return ['evidence/STEP-23-five-component-demo.webm', 'evidence/STEP-23-progression-log.txt'];
  },

  /** STEP 25 — Implement Confirmation (spec: step25-confirmation). */
  async 25() {
    await runEvidenceSpec(25, 'step25');
    return ['evidence/STEP-25-confirmation.png', 'evidence/STEP-25-transaction.json'];
  },

  /** STEP 26 — Implement OrgaTEX Write-back (spec: step26-write-back). */
  async 26() {
    await runEvidenceSpec(26, 'step26');
    return ['evidence/STEP-26-ui.png', 'evidence/STEP-26-request.png', 'evidence/STEP-26-response.png', 'evidence/STEP-26-data.png'];
  },

  /**
   * STEP 27 — Implement Ticket Generation.
   *
   * The ticket and printer captures come from the spec; the test evidence
   * is the ticket suites' run plus the spec's field check, in one image.
   */
  async 27() {
    const { spawnSync } = require('child_process');
    const suites = [
      'tests/unit/ticket-and-print-job.test.ts',
      'tests/integration/ticket-api.test.ts',
      'tests/security/ticket-security.test.ts',
      'tests/ui/completion-screen.test.tsx',
    ];
    const run = spawnSync(`npx vitest run ${suites.join(' ')} --reporter=verbose`, {
      cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const vitest = `${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    if (run.status !== 0) throw new Error('the ticket tests failed');
    const summary = vitest.split(/\r?\n/).filter((line) => /^\s*(Test Files|Tests)\s/.test(line)).map((line) => line.trim());
    const tests = vitest.split(/\r?\n/).filter((line) => /^\s*[✓×]/.test(line)).map((line) => line.trim().replace(/\s+\d+ms$/, ''));

    await runEvidenceSpec(27, 'step27');
    const fieldsFile = path.join(EVIDENCE, 'STEP-27-ticket-fields.json');
    const fields = JSON.parse(fs.readFileSync(fieldsFile, 'utf8'));
    fs.unlinkSync(fieldsFile);

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}
      h2 { font-size: 15px; margin: 16px 0 8px; color: #c9d4e0; }
      .cols { display: grid; grid-template-columns: 1fr 1.6fr; gap: 18px; }
      pre { background: #0b1118; border: 1px solid #253244; padding: 10px 12px; margin: 0; font: 11px/1.45 Consolas, monospace; white-space: pre-wrap; }
      .big { font-size: 20px; }
    </style></head><body>
      <h1>Ticket tests</h1>
      <div class="sub">workbook Step 27 · backfilled evidence ${TODAY}</div>
      <p class="note">Automated: the ticket and print-job suites (unit, API, security, UI). End to end: the Playwright run that completed B-24187, printed the ticket on the Dummy printer and checked the prototype's ten fields.</p>
      <div class="cols"><div>
        <h2>End to end — the prototype's ten fields</h2>
        <table><thead><tr><th>Field</th><th>On the ticket</th><th></th></tr></thead><tbody>
          ${fields.map((f) => `<tr><td>${escapeHtml(f.field)}</td><td>${escapeHtml(f.shows)}</td><td class="${f.ok ? 'ok' : 'warn'}">${f.ok ? '✓' : '✗'}</td></tr>`).join('')}
        </tbody></table>
        <h2>Automated suites</h2>
        <p class="big ok">${escapeHtml(summary.join(' · '))}</p>
        <pre>${escapeHtml(suites.join('\n'))}</pre>
      </div><div>
        <h2>Tests</h2>
        <pre>${escapeHtml(tests.join('\n'))}</pre>
      </div></div>
    </body></html>`;
    await renderPng(html, path.join(EVIDENCE, 'STEP-27-ticket-test.png'));
    console.log(summary.join(' | '));
    return ['evidence/STEP-27-ticket.png', 'evidence/STEP-27-printer-api.png', 'evidence/STEP-27-ticket-test.png'];
  },
};

/**
 * Run one backfill spec against a fresh product
 * (`playwright.evidence.config.ts`), and fail loudly if it fails.
 */
async function runEvidenceSpec(step, filter) {
  const { spawnSync } = require('child_process');
  const run = spawnSync(`npx playwright test -c playwright.evidence.config.ts ${filter}`, {
    cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, EVIDENCE_STEP: String(step) },
  });
  const tail = `${run.stdout}`.split(/\r?\n/).filter((line) => !line.includes('[WebServer]')).slice(-6).join('\n');
  console.log(tail);
  if (run.status !== 0) throw new Error(`the Step ${step} spec failed`);
}

/** Screenshot a step's Playwright report, with its one test opened. */
async function shootReport(step, file) {
  const { pathToFileURL } = require('url');
  const report = pathToFileURL(path.join(EVIDENCE, `STEP-${step}-playwright-report`, 'index.html')).href;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(report, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.getByText(`Step ${step}`).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: true });
  await browser.close();
}

// ---------------------------------------------------------------------------
// The running API — for the steps that probe it.
// ---------------------------------------------------------------------------

const API_URL = process.env.WEIGHINGMS_API_URL ?? 'http://localhost:3000';

/** Sign in, and return the bearer token. */
async function signIn(operatorId, secret) {
  const response = await fetch(`${API_URL}/api/identity/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, secret }),
  });
  if (!response.ok) {
    throw new Error(`sign-in as ${operatorId} → ${response.status}; is the API running (npm run dev:api)?`);
  }
  return (await response.json()).token;
}

/**
 * GET a path and return its status and the first bytes of the answer. A
 * stream (SSE) never ends, so only its first chunk is read.
 */
async function probe(apiPath, token, stream = false) {
  const controller = new AbortController();
  const response = await fetch(`${API_URL}${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  let text;
  if (stream) {
    const reader = response.body.getReader();
    const { value } = await reader.read();
    text = new TextDecoder().decode(value);
    controller.abort();
  } else {
    text = await response.text();
  }
  return { status: response.status, sample: text.replace(/\s+/g, ' ').trim().slice(0, 110) };
}

/** Run git in the project and return its output. */
function git(args) {
  return require('child_process').execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' });
}

async function main() {
  const step = process.argv[2];
  const run = STEPS[step];
  if (run === undefined) {
    console.error(`Usage: node scripts/evidence-backfill.cjs <step>  (one of ${Object.keys(STEPS).join(', ')})`);
    process.exit(1);
  }
  const written = await run();
  for (const file of written) console.log(`wrote ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
