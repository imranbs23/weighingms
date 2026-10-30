/**
 * Step 10 — Decompose the Product Into Units.
 *
 * Produces the two evidence artefacts the workbook requires:
 *   evidence/STEP-10-units.png     — the unit register: every unit, its
 *                                    responsibility, FRs, stories, bolt type
 *   evidence/STEP-10-unit-map.png  — the dependency map and the FR coverage
 *
 * Rendered with the prototype's design tokens so the evidence reads as one
 * family with the Step 8 and Step 9 artefacts.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'evidence');

const TOKENS = {
  bezel: '#0a0d11',
  bg: '#12161c',
  panel: '#1a2029',
  panel2: '#212936',
  line: '#2c3644',
  ink: '#e9eef4',
  muted: '#8998a9',
  dim: '#63717f',
  ok: '#2fbf6b',
  warn: '#f0a726',
  over: '#e8503a',
  steel: '#5b8cc4',
};

const CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; background: ${TOKENS.bezel}; color: ${TOKENS.ink};
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
  .sheet { padding: 20px 24px 24px; }
  .eyebrow {
    font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase;
    color: ${TOKENS.steel}; font-weight: 700; margin: 0 0 4px;
  }
  h1 { font-size: 21px; margin: 0 0 3px; font-weight: 650; letter-spacing: -.01em; }
  .sub { color: ${TOKENS.muted}; font-size: 12px; margin: 0 0 14px; line-height: 1.45; }
  h2 {
    font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase;
    color: ${TOKENS.steel}; margin: 0 0 9px; font-weight: 700;
  }
  h3 {
    font-size: 11px; letter-spacing: .04em; color: ${TOKENS.muted};
    margin: 0 0 5px; font-weight: 700;
  }
  .card {
    background: ${TOKENS.panel}; border: 1px solid ${TOKENS.line};
    border-radius: 9px; padding: 13px 15px;
  }
  .grid { display: grid; gap: 11px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 8px; font-size: 11.5px; vertical-align: top; }
  th {
    color: ${TOKENS.steel}; font-weight: 700; font-size: 10px;
    letter-spacing: .08em; text-transform: uppercase;
    border-bottom: 1px solid ${TOKENS.line};
  }
  td { border-bottom: 1px solid rgba(44,54,68,.5); }
  .dim { color: ${TOKENS.muted}; }
  .dimmer { color: ${TOKENS.dim}; }
  .tag {
    display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: .05em;
    padding: 2px 6px; border-radius: 4px; text-transform: uppercase;
    border: 1px solid currentColor; white-space: nowrap;
  }
  .t-ok { color: ${TOKENS.ok}; } .t-warn { color: ${TOKENS.warn}; }
  .t-over { color: ${TOKENS.over}; } .t-steel { color: ${TOKENS.steel}; }
  .t-muted { color: ${TOKENS.dim}; }
  .foot {
    margin-top: 16px; padding-top: 9px; border-top: 1px solid ${TOKENS.line};
    font-size: 10px; color: ${TOKENS.dim}; line-height: 1.5;
  }
`;

/* ──────────────────────────────────────────────────────────────────────────
   ARTEFACT 1 — the unit register
   ────────────────────────────────────────────────────────────────────────── */

const UNITS = [
  {
    n: '001',
    name: 'batch-management',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-1', 'FR-2'],
    stories: 3,
    purpose: 'Own the set of batches this station may work on, and the act of choosing one.',
    resp: 'Retrieved the released batch queue, presented it, filtered it, and turned “the operator picked a batch” into a durable, identified batch selection.',
    why: 'A read-only projection of a system we do not own, with its own refresh and staleness behaviour. Its change rate is driven by OrgaTEX releases, not by the station’s UI.',
  },
  {
    n: '002',
    name: 'recipe-material-management',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-3', 'FR-4', 'FR-5', 'FR-6'],
    stories: 4,
    purpose: 'Resolve a selected batch into the exact, identified materials the operator must dispense.',
    resp: 'The recipe; dyestuff identity (scan or attest); lot capture; container and tare; and the material facts a weighing depends on — target, unit, tolerance, scale class.',
    why: 'Material identity is captured before any weight exists, is governed by different rules, and has a different failure mode: a wrong lot or container is a traceability defect that survives a perfectly weighed batch.',
  },
  {
    n: '003',
    name: 'weighing-station',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-7', 'FR-8', 'FR-9', 'FR-10', 'FR-11', 'FR-12', 'FR-13', 'FR-14', 'FR-15', 'FR-18'],
    stories: 9,
    purpose: 'The guided weighing itself — read the scale, judge it against tolerance, let the operator confirm it.',
    resp: 'The weighing session and its state machine; automatic scale selection; the live weight stream; the tolerance zone on every reading; confirmation gating; over-dose, compensation and escalation; progression; completion summary; operator traceability.',
    why: 'It owns the only stateful correctness requirements in the system (immutability, idempotent progression, resumability) and must be provable without a UI. It also holds the highest-risk logic in the build.',
    core: true,
  },
  {
    n: '004',
    name: 'scale-integration',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-19*'],
    stories: 4,
    purpose: 'Turn a physical scale into a reliable, live weight feed — and into a detected failure when it stops.',
    resp: 'The scale adapter and transport; the ≥10 Hz stream with a stability flag; tare; status, disconnection within 2 s and calibration state; automatic selection between the 3 kg and 32 kg scales; the training dispersion ramp as a device behaviour.',
    why: 'It owns the hardest external contract and the worst documentation. A-05 and B-5 say that if only a stabilised value exists, guided weighing as drawn is not buildable — so that risk is isolated behind one interface.',
    leaf: true,
  },
  {
    n: '005',
    name: 'orgatex-integration',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-16', 'FR-19*', 'FR-20'],
    stories: 5,
    purpose: 'The single seam through which WeighingMS talks to the MES — and the only place an undocumented contract can be wrong.',
    resp: 'The OrgaTEX adapter; queue and recipe reads; batch status and idempotent consumption writes; the link state; the deferred synchronisation queue and its retry policy; the training MES.',
    why: 'It owns the only contract we do not have, it has a failure mode nothing else has (the system must keep weighing while it is down), and it changes when SETEX ships rather than when FCI changes a rule.',
    leaf: true,
  },
  {
    n: '006',
    name: 'ticket-printing',
    type: 'backend',
    bolt: 'ddd',
    frs: ['FR-17', 'FR-21', 'FR-22', 'FR-23'],
    stories: 5,
    purpose: 'Produce the weighing ticket and label, and the administrative record around privileged actions.',
    resp: 'Ticket rendering; print jobs and reprint marking; the append-only audit trail; configuration and localisation without redeployment; operational reporting.',
    why: 'Supporting capabilities with a different owner and change rate — the template changes when a printer is chosen, the language when a second site appears. Printing has its own failure mode: a printer that is out of paper must not cost a weighing.',
  },
  {
    n: '007',
    name: 'weighingms-ui',
    type: 'frontend',
    bolt: 'simple',
    frs: [],
    stories: 5,
    purpose: 'The operator terminal.',
    resp: 'The three views and their transitions; the recipe rail; the live readout, tolerance band and status line; the surplus and escalation panels; the action row and F1–F4; the peripheral status strip; the degraded states; gloved-hand ergonomics.',
    why: 'The catalogue mandates a frontend unit for full-stack-web, and it is genuinely separable: the only unit with a rendering concern, the only one tested for ergonomics rather than correctness, and the only one whose failure is degraded but not incorrect.',
    nofr: true,
  },
  {
    n: '008',
    name: 'operator-identity',
    type: 'backend',
    bolt: 'ddd',
    frs: [],
    stories: 2,
    purpose: 'Establish who is at the terminal, and authorise the actions that need more than an operator.',
    resp: 'Sign-in and sign-out; identity and role; supervisor authentication for privileged actions; session lifetime; credential policy; the identity stamp on records and audit entries.',
    why: 'Small, but it holds the tightest security requirement in the build (NFR-12) and the only unit where a defect is a compliance breach rather than a usability bug. Q-08 also lands here — exactly why it deserves its own boundary.',
    leaf: true,
    nofr: true,
  },
];

function unitCard(u) {
  const frCells = u.frs.length
    ? u.frs.map((f) => `<span class="tag t-steel">${f}</span>`).join(' ')
    : '<span class="tag t-muted">none — consumes all via API</span>';
  const badges = [
    `<span class="tag ${u.type === 'frontend' ? 't-warn' : 't-steel'}">${u.type}</span>`,
    `<span class="tag t-muted">${u.bolt}-bolt</span>`,
    u.leaf ? '<span class="tag t-ok">leaf</span>' : '',
    u.core ? '<span class="tag t-over">core · 11 FRs</span>' : '',
    u.nofr ? '<span class="tag t-muted">no FR of its own</span>' : '',
  ].filter(Boolean).join(' ');

  return `
  <div class="card">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px">
      <span class="mono" style="color:${TOKENS.steel};font-size:12px;font-weight:700">${u.n}</span>
      <strong style="font-size:13.5px">${u.name}</strong>
    </div>
    <div style="margin-bottom:8px">${badges}</div>
    <p style="margin:0 0 6px;font-size:11.5px;color:${TOKENS.ink};line-height:1.45">${u.purpose}</p>
    <div style="margin-bottom:6px">
      <h3>Responsibility</h3>
      <p style="margin:0;font-size:11px;color:${TOKENS.muted};line-height:1.45">${u.resp}</p>
    </div>
    <div style="margin-bottom:7px">
      <h3>Why separate</h3>
      <p style="margin:0;font-size:11px;color:${TOKENS.muted};line-height:1.45">${u.why}</p>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${frCells}
      <span style="flex:1"></span>
      <span class="dimmer" style="font-size:10.5px">${u.stories} stories</span>
    </div>
  </div>`;
}

const REGISTER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Unit Register</title><style>${CSS}</style></head><body><div class="sheet">

<p class="eyebrow">Step 10 · Unit Decomposition · WeighingMS</p>
<h1>Unit register — eight units, one per capability</h1>
<p class="sub">
  Units are <strong style="color:${TOKENS.ink}">capabilities, not screens and not layers</strong>. A unit is a cohesion boundary with a
  reason to be separable, an interface others can depend on, and a failure mode that does not cascade.
  Every functional requirement lands in exactly one unit — none is orphaned, none is shared silently.
</p>

<div class="grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
  ${UNITS.map(unitCard).join('')}
</div>

<div class="grid" style="grid-template-columns:1.15fr 1fr">
  <div class="card">
    <h2>Requirements coverage</h2>
    <table>
      <thead><tr><th style="width:64px">FR</th><th>Requirement</th><th style="width:206px">Unit</th></tr></thead>
      <tbody>
        <tr><td class="mono">FR-1</td><td class="dim">Batch queue retrieval and display</td><td class="mono" style="color:${TOKENS.muted}">001</td></tr>
        <tr><td class="mono">FR-2</td><td class="dim">Batch selection by barcode or touch</td><td class="mono" style="color:${TOKENS.muted}">001</td></tr>
        <tr><td class="mono">FR-3</td><td class="dim">Recipe retrieval and component list</td><td class="mono" style="color:${TOKENS.muted}">002</td></tr>
        <tr><td class="mono">FR-4</td><td class="dim">Component identification and identity verification</td><td class="mono" style="color:${TOKENS.muted}">002</td></tr>
        <tr><td class="mono">FR-5</td><td class="dim">Dyestuff lot capture</td><td class="mono" style="color:${TOKENS.muted}">002</td></tr>
        <tr><td class="mono">FR-6</td><td class="dim">Container assignment and tare handling</td><td class="mono" style="color:${TOKENS.muted}">002</td></tr>
        <tr><td class="mono">FR-7</td><td class="dim">Automatic scale selection</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-8</td><td class="dim">Live weight stream and guided dispensing</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-9</td><td class="dim">Tolerance zones and status signalling</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-10</td><td class="dim">Confirmation gating</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-11</td><td class="dim">Over-dose detection, overshoot and surplus</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-12</td><td class="dim">Surplus compensation</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-13</td><td class="dim">Non-compensable over-dose escalation</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-14</td><td class="dim">Component progression</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-15</td><td class="dim">Batch completion summary</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-16</td><td class="dim">OrgaTEX write-back</td><td class="mono" style="color:${TOKENS.muted}">005</td></tr>
        <tr><td class="mono">FR-17</td><td class="dim">Ticket generation</td><td class="mono" style="color:${TOKENS.muted}">006</td></tr>
        <tr><td class="mono">FR-18</td><td class="dim">Operator identification and traceability</td><td class="mono" style="color:${TOKENS.muted}">003</td></tr>
        <tr><td class="mono">FR-19</td><td class="dim">Peripheral status and failure handling</td><td class="mono" style="color:${TOKENS.muted}">004 + 005</td></tr>
        <tr><td class="mono">FR-20</td><td class="dim">Offline operation and deferred synchronisation</td><td class="mono" style="color:${TOKENS.muted}">005</td></tr>
        <tr><td class="mono">FR-21</td><td class="dim">Privileged actions and audit trail</td><td class="mono" style="color:${TOKENS.muted}">006</td></tr>
        <tr><td class="mono">FR-22</td><td class="dim">Configuration and localisation</td><td class="mono" style="color:${TOKENS.muted}">006</td></tr>
        <tr><td class="mono">FR-23</td><td class="dim">Operational reporting</td><td class="mono" style="color:${TOKENS.muted}">006</td></tr>
      </tbody>
    </table>
  </div>

  <div class="grid" style="align-content:start">
    <div class="card">
      <h2>Coverage check</h2>
      <table>
        <tbody>
          <tr><td class="dim">Functional requirements</td><td style="text-align:right"><strong>23</strong></td></tr>
          <tr><td class="dim">Assigned one-to-one</td><td style="text-align:right"><strong>22</strong></td></tr>
          <tr><td class="dim">Assigned by explicit split (FR-19)</td><td style="text-align:right"><strong>1</strong></td></tr>
          <tr><td class="dim">Orphaned</td><td style="text-align:right;color:${TOKENS.ok}"><strong>0</strong></td></tr>
          <tr><td class="dim">Silently shared</td><td style="text-align:right;color:${TOKENS.ok}"><strong>0</strong></td></tr>
        </tbody>
      </table>
      <p style="margin:8px 0 0;font-size:11px;color:${TOKENS.muted};line-height:1.45">
        FR-19 is the one requirement covering two peripherals with two failure modes.
        Its scale half sits in <span class="mono">004</span>; its OrgaTEX half in
        <span class="mono">005</span>; the scanner half in <span class="mono">002</span>;
        the printer half in <span class="mono">006</span>. The split is stated, not implied.
      </p>
    </div>

    <div class="card">
      <h2>Two capabilities deliberately not created</h2>
      <table>
        <tbody>
          <tr>
            <td style="width:132px"><strong>Tolerance / zone engine</strong></td>
            <td class="dim" style="font-size:11px">
              A pure value computation over two inputs and one reading. No state, no persistence,
              no external contract, no independent failure mode — and extracting it would put a
              network hop between the scale and the confirm button, against NFR-01’s ≤200 ms.
              Modelled as a <span class="mono">ToleranceZone</span> value object inside
              <span class="mono">003</span>, with its own boundary suite.
            </td>
          </tr>
          <tr>
            <td style="width:132px"><strong>Session / weighing state</strong></td>
            <td class="dim" style="font-size:11px">
              The rule <em>is</em> the state transition. Splitting them yields a shared mutable
              object across a network boundary — the classic way to lose the immutability guarantee
              (DR-02) the product exists to provide.
            </td>
          </tr>
        </tbody>
      </table>
      <p style="margin:8px 0 0;font-size:11px;color:${TOKENS.muted};line-height:1.45">
        The scanner and the printer were likewise not given units: neither has logic of its own,
        only transport.
      </p>
    </div>

    <div class="card">
      <h2>Judgement calls flagged for Checkpoint 3</h2>
      <ol style="margin:0;padding-left:17px;font-size:11px;color:${TOKENS.muted};line-height:1.5">
        <li style="margin-bottom:4px"><strong style="color:${TOKENS.ink}">Unit 003 carries 11 FRs</strong> and is large. A reviewer who prefers smaller units may want to revisit the split.</li>
        <li style="margin-bottom:4px"><strong style="color:${TOKENS.ink}">Unit 008 has no FR of its own.</strong> A reviewer who prefers strict FR-per-unit discipline may prefer to fold it into 003.</li>
        <li><strong style="color:${TOKENS.ink}">Ticket and audit trail share a unit.</strong> Both are supporting capabilities with a different owner and change rate. Separable if preferred.</li>
      </ol>
    </div>
  </div>
</div>

<div class="foot">
  Full document: <span class="mono">memory-bank/intents/001-assisted-dyestuff-weighing-station/units.md</span> ·
  Unit briefs: <span class="mono">units/{unit}/unit-brief.md</span> ·
  37 stories across 8 units · 8 backend + 1 frontend bolt types recorded in each brief.
</div>

</div></body></html>`;

/* ──────────────────────────────────────────────────────────────────────────
   ARTEFACT 2 — the unit map
   ────────────────────────────────────────────────────────────────────────── */

const MAP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Unit Map</title><style>${CSS}</style></head><body><div class="sheet">

<p class="eyebrow">Step 10 · Unit Decomposition · WeighingMS</p>
<h1>Unit dependency map and execution order</h1>
<p class="sub">
  Three leaf units carry no internal dependency. Unit 003 is the core and depends on four of them.
  The frontend sits on top of everything. <strong style="color:${TOKENS.ink}">Each unit’s failure is
  contained at its own boundary</strong> — a scale that goes silent blocks weighing without corrupting
  it; a printer that runs out of paper never costs a weighing.
</p>

<div class="card" style="margin-bottom:14px">
  <h2>Dependency map</h2>
  <svg viewBox="0 0 1400 640" style="width:100%;display:block">
    <defs>
      <marker id="m1" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.steel}"/>
      </marker>
      <marker id="m2" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.steel}"/>
      </marker>
      <marker id="m3" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.dim}"/>
      </marker>
    </defs>

    <!-- ── LEAF ROW ── -->
    <text x="20" y="20" fill="${TOKENS.dim}" font-size="10" font-weight="700" letter-spacing="1.6">LEAF UNITS — NO INTERNAL DEPENDENCIES</text>

    <!-- 008 -->
    <rect x="20" y="32" width="290" height="104" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.line}"/>
    <text x="36" y="52" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">008 · OPERATOR IDENTITY</text>
    <text x="36" y="72" fill="${TOKENS.ink}" font-size="12.5" font-weight="700">sign-in · roles · supervisor auth</text>
    <text x="36" y="91" fill="${TOKENS.muted}" font-size="10.5">the unit with the tightest security</text>
    <text x="36" y="107" fill="${TOKENS.dim}" font-size="10.5">requirement in the build (NFR-12)</text>
    <text x="36" y="124" fill="${TOKENS.warn}" font-size="10">source undecided — Q-08</text>

    <!-- 004 -->
    <rect x="330" y="32" width="290" height="104" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.5"/>
    <text x="346" y="52" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">004 · SCALE INTEGRATION</text>
    <text x="346" y="72" fill="${TOKENS.ink}" font-size="12.5" font-weight="700">SSE weight · tare · 2 s watchdog</text>
    <text x="346" y="91" fill="${TOKENS.muted}" font-size="10.5">owns the hardest external contract</text>
    <text x="346" y="107" fill="${TOKENS.dim}" font-size="10.5">a silent scale is never a zero weight</text>
    <text x="346" y="124" fill="${TOKENS.over}" font-size="10">A-05 · B-5 — the shape risk</text>

    <!-- 005 -->
    <rect x="640" y="32" width="290" height="104" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.5"/>
    <text x="656" y="52" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">005 · ORGATEX INTEGRATION</text>
    <text x="656" y="72" fill="${TOKENS.ink}" font-size="12.5" font-weight="700">the MES seam · queue · idempotency</text>
    <text x="656" y="91" fill="${TOKENS.muted}" font-size="10.5">owns the contract we do not have</text>
    <text x="656" y="107" fill="${TOKENS.dim}" font-size="10.5">weighing continues while it is down</text>
    <text x="656" y="124" fill="${TOKENS.over}" font-size="10">A-01 · A-02 — the premise risk</text>

    <!-- 002 (leaf-ish, depends on 005+004) -->
    <rect x="950" y="32" width="290" height="104" rx="9" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="966" y="52" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">002 · RECIPE &amp; MATERIAL</text>
    <text x="966" y="72" fill="${TOKENS.ink}" font-size="12.5" font-weight="700">recipe · identity · lot · container · tare</text>
    <text x="966" y="91" fill="${TOKENS.muted}" font-size="10.5">depends on 005 (recipe read) and</text>
    <text x="966" y="107" fill="${TOKENS.dim}" font-size="10.5">004 (scale class)</text>
    <text x="966" y="124" fill="${TOKENS.warn}" font-size="10">Q-07 · Q-10 · CQ-08 land here</text>

    <!-- ── ARROWS: leaves → 003 ── -->
    <path d="M165,136 L165,196" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m1)"/>
    <path d="M475,136 L475,196" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m1)"/>
    <path d="M785,136 L785,196" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m1)"/>
    <path d="M1095,136 L1095,196" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m1)"/>
    <text x="176" y="170" fill="${TOKENS.dim}" font-size="9.5">identity</text>
    <text x="486" y="170" fill="${TOKENS.dim}" font-size="9.5">weight</text>
    <text x="796" y="170" fill="${TOKENS.dim}" font-size="9.5">status · writes</text>
    <text x="1106" y="170" fill="${TOKENS.dim}" font-size="9.5">targets · tolerances</text>

    <!-- ── CORE ── -->
    <rect x="20" y="200" width="1220" height="150" rx="11" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="2"/>
    <text x="40" y="224" fill="${TOKENS.over}" font-size="11" font-weight="700" letter-spacing="1.4">003 · WEIGHING STATION — THE CORE</text>
    <text x="40" y="248" fill="${TOKENS.ink}" font-size="15" font-weight="700">Session state machine + tolerance engine</text>
    <text x="40" y="268" fill="${TOKENS.muted}" font-size="11">Owns eleven of twenty-three functional requirements and the entire session state machine. Unit 007 owns none.</text>
    <text x="40" y="284" fill="${TOKENS.dim}" font-size="11">AWAITING_BATCH → AWAITING_COMPONENT → WEIGHING → CONFIRMING → (COMPENSATING → ESCALATED) → COMPLETE</text>

    <g>
      <rect x="40" y="296" width="170" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="125" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">7 invariants</text>
      <text x="125" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">one active · DONE terminal</text>
    </g>
    <g>
      <rect x="222" y="296" width="170" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="307" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">ToleranceZone</text>
      <text x="307" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">UNDER · NEAR · OK · OVER</text>
    </g>
    <g>
      <rect x="404" y="296" width="190" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="499" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">Immutable records</text>
      <text x="499" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">append-only · correction = new row</text>
    </g>
    <g>
      <rect x="606" y="296" width="190" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="701" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">Compensation</text>
      <text x="701" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">surplus ÷ total remaining</text>
    </g>
    <g>
      <rect x="808" y="296" width="190" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="903" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">Escalation</text>
      <text x="903" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">supervisor + reason, audited</text>
    </g>
    <g>
      <rect x="1010" y="296" width="210" height="40" rx="6" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
      <text x="1115" y="313" text-anchor="middle" fill="${TOKENS.ink}" font-size="10.5" font-weight="700">Resumable</text>
      <text x="1115" y="328" text-anchor="middle" fill="${TOKENS.dim}" font-size="9.5">at the component in progress</text>
    </g>

    <!-- ── UPPER ROW ── -->
    <path d="M330,354 L330,406" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m2)"/>
    <path d="M1090,354 L1090,406" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m2)"/>
    <text x="341" y="384" fill="${TOKENS.dim}" font-size="9.5">what was weighed</text>
    <text x="1101" y="384" fill="${TOKENS.dim}" font-size="9.5">the selected batch</text>

    <rect x="120" y="410" width="420" height="96" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="136" y="430" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">006 · TICKET, PRINTING, AUDIT &amp; CONFIG</text>
    <text x="136" y="452" fill="${TOKENS.ink}" font-size="13" font-weight="700">ticket · print jobs · audit trail · config · locale · reports</text>
    <text x="136" y="471" fill="${TOKENS.muted}" font-size="10.5">a printer failure must never cost a weighing (B-7)</text>
    <text x="136" y="489" fill="${TOKENS.dim}" font-size="10.5">depends on 003 (records), 001 (batch identity), 008 (actor)</text>

    <rect x="750" y="410" width="420" height="96" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="766" y="430" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1">001 · BATCH MANAGEMENT</text>
    <text x="766" y="452" fill="${TOKENS.ink}" font-size="13" font-weight="700">queue · filter · eligibility · selection (scan or touch)</text>
    <text x="766" y="471" fill="${TOKENS.muted}" font-size="10.5">only a RELEASED batch is selectable — and the reason is shown</text>
    <text x="766" y="489" fill="${TOKENS.dim}" font-size="10.5">the queue is never cached here; caching belongs to 005</text>

    <!-- 001 → 002 : the recipe load (narrow cycle, owned by 002) -->
    <path d="M1170,458 L1258,458 L1258,150 L1244,150" stroke="${TOKENS.warn}" stroke-width="1.2" fill="none" stroke-dasharray="4 3" marker-end="url(#m3)"/>
    <text x="1266" y="270" fill="${TOKENS.warn}" font-size="9.5">recipe load</text>
    <text x="1266" y="283" fill="${TOKENS.dim}" font-size="9">narrow cycle —</text>
    <text x="1266" y="294" fill="${TOKENS.dim}" font-size="9">one call</text>
    <text x="1266" y="305" fill="${TOKENS.dim}" font-size="9">owned by 002</text>

    <!-- ── FRONTEND ── -->
    <path d="M330,510 L330,546" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m2)"/>
    <path d="M960,510 L960,546" stroke="${TOKENS.steel}" stroke-width="1.3" fill="none" marker-end="url(#m2)"/>
    <path d="M1095,136 L1352,136 L1352,590 L1330,590" stroke="${TOKENS.dim}" stroke-width="1.1" fill="none" stroke-dasharray="4 4" marker-end="url(#m3)"/>

    <rect x="20" y="540" width="1340" height="86" rx="10" fill="${TOKENS.panel2}" stroke="${TOKENS.warn}" stroke-width="1.5"/>
    <text x="40" y="562" fill="${TOKENS.warn}" font-size="11" font-weight="700" letter-spacing="1.4">007 · WEIGHINGMS UI — FRONTEND · CARRIES NO FR OF ITS OWN</text>
    <text x="40" y="585" fill="${TOKENS.ink}" font-size="14" font-weight="700">The three views, the live readout, the tolerance band, the status line, the surplus panel, the action row, the status strip</text>
    <text x="40" y="604" fill="${TOKENS.muted}" font-size="11">Consumes the session API and the peripheral APIs. Nothing about a batch, a recipe, a weight or a link state is hard-coded in the client.</text>
    <text x="40" y="620" fill="${TOKENS.dim}" font-size="10.5">This is the check the decomposition is judged on: if the Weighing Station were a screen, unit 003 would not exist and 007 would carry FR-7 … FR-15.</text>
  </svg>
</div>

<div class="grid" style="grid-template-columns:1fr 1fr">
  <div class="card">
    <h2>Execution order — dependencies, not days</h2>
    <table>
      <thead><tr><th style="width:40px">#</th><th style="width:210px">Unit</th><th>Why here</th><th style="width:64px">Size</th></tr></thead>
      <tbody>
        <tr><td class="mono">1</td><td class="mono" style="color:${TOKENS.muted}">008-operator-identity</td><td class="dim">Leaf; its operator stamp is needed by 002, 003 and 006.</td><td class="dimmer">S</td></tr>
        <tr><td class="mono">1</td><td class="mono" style="color:${TOKENS.muted}">004-scale-integration</td><td class="dim">Leaf; the substrate the weighing runs on, and the earliest de-risk of A-05.</td><td class="dimmer">M</td></tr>
        <tr><td class="mono">1</td><td class="mono" style="color:${TOKENS.muted}">005-orgatex-integration</td><td class="dim">Leaf; the substrate for 001 and 002, and the idempotency contract.</td><td class="dimmer">M</td></tr>
        <tr><td class="mono">2</td><td class="mono" style="color:${TOKENS.muted}">002-recipe-material-mgmt</td><td class="dim">Needs 005 and 004; resolves Q-07 and Q-10 into a data model.</td><td class="dimmer">M</td></tr>
        <tr><td class="mono">2</td><td class="mono" style="color:${TOKENS.muted}">001-batch-management</td><td class="dim">Needs 005 for the queue and 002 for the recipe load.</td><td class="dimmer">S</td></tr>
        <tr><td class="mono">3</td><td class="mono" style="color:${TOKENS.over}">003-weighing-station</td><td class="dim">The core, built on three proven substrates.</td><td class="dimmer">L</td></tr>
        <tr><td class="mono">4</td><td class="mono" style="color:${TOKENS.muted}">006-ticket-printing</td><td class="dim">Needs 003 and 001; runs in parallel with 007.</td><td class="dimmer">M</td></tr>
        <tr><td class="mono">4</td><td class="mono" style="color:${TOKENS.muted}">007-weighingms-ui</td><td class="dim">Needs all backend units.</td><td class="dimmer">L</td></tr>
        <tr><td class="mono">5</td><td class="mono" style="color:${TOKENS.dim}">integration &amp; E2E</td><td class="dim">Needs everything.</td><td class="dimmer">M</td></tr>
      </tbody>
    </table>
    <p style="margin:8px 0 0;font-size:10.5px;color:${TOKENS.dim}">Units at the same order number have no dependency on each other and can be built in parallel.</p>
  </div>

  <div class="card">
    <h2>Independence validation</h2>
    <table>
      <thead><tr><th>Unit</th><th style="width:60px">Own team</th><th style="width:74px">Clear interface</th><th style="width:96px">No cascading failure</th></tr></thead>
      <tbody>
        <tr><td class="mono" style="color:${TOKENS.muted}">001-batch-management</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">002-recipe-material-mgmt</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.over}">003-weighing-station</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.warn}">by design</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">004-scale-integration</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">005-orgatex-integration</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">006-ticket-printing</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">007-weighingms-ui</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
        <tr><td class="mono" style="color:${TOKENS.muted}">008-operator-identity</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td><td style="color:${TOKENS.ok}">✓</td></tr>
      </tbody>
    </table>
    <p style="margin:9px 0 0;font-size:11px;color:${TOKENS.muted};line-height:1.5">
      Unit 003’s “by design” entry is not a defect. It is the core: its failure stops weighing,
      which is the correct behaviour. Every other unit’s failure is contained at its own boundary —
      B-3 blocks weighing at the scale rather than corrupting it; B-7 isolates printer failure from
      the weighing record; B-1 is the whole point of the offline queue.
    </p>
  </div>
</div>

<div class="foot">
  Full document: <span class="mono">memory-bank/intents/001-assisted-dyestuff-weighing-station/units.md</span> ·
  Eight unit briefs under <span class="mono">units/{unit}/unit-brief.md</span> ·
  <strong style="color:${TOKENS.muted}">Solid arrows = dependency. Dashed = the narrow 001↔002 recipe-load cycle and the frontend’s consumption of every unit.</strong>
</div>

</div></body></html>`;

/* ────────────────────────────────────────────────────────────────────────── */

async function shoot(browser, html, file) {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: 1,
  });
  const p = await ctx.newPage();
  const tmp = path.join(OUT, `.tmp-${file.replace(/\.png$/, '')}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  await p.goto('file:///' + tmp.replace(/\\/g, '/'));
  await p.waitForTimeout(400);
  const body = await p.$('body');
  await body.screenshot({ path: path.join(OUT, file) });
  await ctx.close();
  fs.unlinkSync(tmp);
  console.log('  wrote ' + file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await shoot(browser, REGISTER_HTML, 'STEP-10-units.png');
    await shoot(browser, MAP_HTML, 'STEP-10-unit-map.png');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
