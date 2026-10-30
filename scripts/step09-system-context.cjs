/**
 * Step 9 — Create System Context.
 *
 * Produces the two evidence artefacts the workbook requires:
 *   evidence/STEP-09-system-context.png
 *   evidence/STEP-09-system-context.md   (a short pointer note; the full
 *                                         document lives in the memory bank)
 *
 * The PNG is a rendered boundary diagram, generated from the same source of
 * truth as system-context.md. It uses the prototype's design tokens so the
 * evidence reads as one family with the Step 8 artefacts.
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
  .lane { fill: none; stroke-width: 1.2; }
`;

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>System Context</title><style>${CSS}</style></head><body><div class="sheet">

<p class="eyebrow">Step 9 · System Context · WeighingMS</p>
<h1>System context — Assisted Dyestuff Weighing Station</h1>
<p class="sub">
  What lies outside WeighingMS, what crosses each boundary, who owns what, and where the system
  is allowed to fail. <strong style="color:${TOKENS.ink}">Real systems are drawn solid;
  training substitutes are drawn dashed.</strong> Three of the six external contracts are
  undocumented — the boundary and the direction of data flow are specified; the contract is not.
</p>

<!-- ══════════════ BOUNDARY DIAGRAM ══════════════ -->
<div class="card" style="margin-bottom:14px">
  <h2>Boundary map</h2>
  <svg viewBox="0 0 1420 620" style="width:100%;display:block">
    <defs>
      <marker id="ar" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.steel}"/>
      </marker>
      <marker id="ar2" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.steel}"/>
      </marker>
      <marker id="arw" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
        <path d="M0,0 L6.5,3 L0,6 Z" fill="${TOKENS.warn}"/>
      </marker>
    </defs>

    <!-- ============ HUMAN LANE ============ -->
    <rect x="8" y="10" width="1404" height="104" rx="9" fill="#151a22" stroke="${TOKENS.line}"/>
    <text x="22" y="28" fill="${TOKENS.dim}" font-size="10" font-weight="700" letter-spacing="1.6">HUMAN ACTORS</text>

    <!-- operator -->
    <rect x="24" y="38" width="196" height="62" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="122" y="58" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Weighing Operator</text>
    <text x="122" y="74" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">Primary · gloved hands</text>
    <text x="122" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">dispenses by hand</text>

    <!-- supervisor -->
    <rect x="236" y="38" width="196" height="62" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="334" y="58" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Dyehouse Supervisor</text>
    <text x="334" y="74" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">Privileged · authorises</text>
    <text x="334" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">overrides</text>

    <!-- consumers -->
    <rect x="448" y="38" width="180" height="62" rx="8" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="538" y="58" fill="${TOKENS.muted}" text-anchor="middle" font-size="12" font-weight="700">Lab / QA</text>
    <text x="538" y="75" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">consumes the record</text>
    <text x="538" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">not a user</text>

    <rect x="644" y="38" width="180" height="62" rx="8" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="734" y="58" fill="${TOKENS.muted}" text-anchor="middle" font-size="12" font-weight="700">Store / Inventory</text>
    <text x="734" y="75" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">consumes the record</text>
    <text x="734" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">not a user</text>

    <rect x="840" y="38" width="180" height="62" rx="8" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="930" y="58" fill="${TOKENS.muted}" text-anchor="middle" font-size="12" font-weight="700">FCI IT</text>
    <text x="930" y="75" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">network · deploy</text>
    <text x="930" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">backup</text>

    <rect x="1036" y="38" width="180" height="62" rx="8" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="1126" y="58" fill="${TOKENS.muted}" text-anchor="middle" font-size="12" font-weight="700">FCI Management</text>
    <text x="1126" y="75" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">accepts the scope</text>
    <text x="1126" y="89" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">sign-off</text>

    <!-- ============ REAL EXTERNAL LANE ============ -->
    <rect x="8" y="132" width="1404" height="160" rx="9" fill="#151a22" stroke="${TOKENS.line}"/>
    <text x="22" y="150" fill="${TOKENS.dim}" font-size="10" font-weight="700" letter-spacing="1.6">REAL SYSTEMS — UNAVAILABLE IN THIS BUILD · CONTRACTS UNDOCUMENTED</text>

    <!-- OrgaTEX -->
    <rect x="24" y="160" width="256" height="120" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.6"/>
    <text x="152" y="181" fill="${TOKENS.ink}" text-anchor="middle" font-size="13.5" font-weight="700">OrgaTEX MES</text>
    <text x="152" y="196" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5" letter-spacing="1">OWNED BY SETEX</text>
    <line x1="44" y1="205" x2="260" y2="205" stroke="${TOKENS.line}"/>
    <text x="152" y="220" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">system of record for batches,</text>
    <text x="152" y="233" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">recipes, tolerances, master data</text>
    <text x="152" y="254" fill="${TOKENS.ok}" text-anchor="middle" font-size="10">◀ reads: queue, recipe</text>
    <text x="152" y="269" fill="${TOKENS.warn}" text-anchor="middle" font-size="10">writes: status, consumption ▶</text>

    <!-- scale 3 -->
    <rect x="300" y="160" width="212" height="120" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.6"/>
    <text x="406" y="181" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Scale · 3 kg precision</text>
    <line x1="318" y1="190" x2="494" y2="190" stroke="${TOKENS.line}"/>
    <text x="406" y="207" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">continuous weight</text>
    <text x="406" y="221" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">+ stability flag</text>
    <text x="406" y="241" fill="${TOKENS.ok}" text-anchor="middle" font-size="10">◀ streams readings</text>
    <text x="406" y="256" fill="${TOKENS.warn}" text-anchor="middle" font-size="10">sends: tare ▶</text>
    <text x="406" y="272" fill="${TOKENS.over}" text-anchor="middle" font-size="9.5">protocol unknown</text>

    <!-- scale 32 -->
    <rect x="532" y="160" width="212" height="120" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.6"/>
    <text x="638" y="181" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Scale · 32 kg floor</text>
    <line x1="550" y1="190" x2="726" y2="190" stroke="${TOKENS.line}"/>
    <text x="638" y="207" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">continuous weight</text>
    <text x="638" y="221" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">+ stability flag</text>
    <text x="638" y="241" fill="${TOKENS.ok}" text-anchor="middle" font-size="10">◀ streams readings</text>
    <text x="638" y="256" fill="${TOKENS.warn}" text-anchor="middle" font-size="10">sends: tare ▶</text>
    <text x="638" y="272" fill="${TOKENS.over}" text-anchor="middle" font-size="10">protocol unknown</text>

    <!-- scanner -->
    <rect x="764" y="160" width="212" height="120" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.6"/>
    <text x="870" y="181" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Barcode Scanner</text>
    <line x1="782" y1="190" x2="958" y2="190" stroke="${TOKENS.line}"/>
    <text x="870" y="207" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">batch · material · lot</text>
    <text x="870" y="221" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">identification</text>
    <text x="870" y="241" fill="${TOKENS.ok}" text-anchor="middle" font-size="10">◀ delivers codes</text>
    <text x="870" y="258" fill="${TOKENS.over}" text-anchor="middle" font-size="9.5">barcodes assumed</text>

    <!-- printer -->
    <rect x="996" y="160" width="212" height="120" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.over}" stroke-width="1.6"/>
    <text x="1102" y="181" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Label Printer</text>
    <line x1="1014" y1="190" x2="1190" y2="190" stroke="${TOKENS.line}"/>
    <text x="1102" y="207" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">weighing ticket</text>
    <text x="1102" y="221" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">and label</text>
    <text x="1102" y="241" fill="${TOKENS.warn}" text-anchor="middle" font-size="10">sends: rendered ▶</text>
    <text x="1102" y="258" fill="${TOKENS.over}" text-anchor="middle" font-size="9.5">content undefined</text>

    <!-- identity -->
    <rect x="1228" y="160" width="170" height="120" rx="9" fill="${TOKENS.panel}" stroke="${TOKENS.line}" stroke-dasharray="4 3"/>
    <text x="1313" y="181" fill="${TOKENS.muted}" text-anchor="middle" font-size="12" font-weight="700">Identity Source</text>
    <text x="1313" y="196" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">UNDECIDED</text>
    <line x1="1246" y1="205" x2="1380" y2="205" stroke="${TOKENS.line}"/>
    <text x="1313" y="221" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">operator identity</text>
    <text x="1313" y="235" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">+ supervisor auth</text>
    <text x="1313" y="255" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">no dummy — a local</text>
    <text x="1313" y="268" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">concern of the station</text>

    <!-- ============ SYSTEM LANE ============ -->
    <rect x="8" y="310" width="1404" height="212" rx="9" fill="#101820" stroke="${TOKENS.ok}" stroke-width="1.8"/>
    <text x="22" y="328" fill="${TOKENS.ok}" font-size="10" font-weight="700" letter-spacing="1.6">THE SYSTEM BEING BUILT — WEIGHINGMS</text>

    <!-- UI -->
    <rect x="24" y="340" width="212" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="130" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Operator Terminal UI</text>
    <text x="130" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">3 views: queue · weigh · done</text>
    <text x="130" y="392" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">gloved, ≥15 mm targets</text>
    <text x="130" y="407" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">all text externalised</text>

    <!-- API -->
    <rect x="256" y="340" width="212" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="362" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Application API</text>
    <text x="362" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">session state machine</text>
    <text x="362" y="392" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">resumable mid-batch</text>

    <!-- tolerance engine -->
    <rect x="488" y="340" width="212" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.ok}"/>
    <text x="594" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Tolerance &amp; Zone Engine</text>
    <text x="594" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">under · near · ok · over</text>
    <text x="594" y="392" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">gates confirmation</text>
    <text x="594" y="407" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">fixed-point decimal</text>

    <!-- records -->
    <rect x="720" y="340" width="212" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="826" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Weighing Records</text>
    <text x="826" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">append-only · immutable</text>
    <text x="826" y="392" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">retained ≥ 5 years</text>

    <!-- audit -->
    <rect x="952" y="340" width="212" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}"/>
    <text x="1058" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Audit Trail</text>
    <text x="1058" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">privileged actions</text>
    <text x="1058" y="392" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">immutable · exportable</text>

    <!-- adapters -->
    <rect x="1184" y="340" width="214" height="80" rx="8" fill="${TOKENS.panel2}" stroke="${TOKENS.warn}"/>
    <text x="1291" y="360" fill="${TOKENS.ink}" text-anchor="middle" font-size="12.5" font-weight="700">Adapters</text>
    <text x="1291" y="376" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">orgatex · scale · scanner</text>
    <text x="1291" y="392" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">printer</text>
    <text x="1291" y="407" fill="${TOKENS.warn}" text-anchor="middle" font-size="9.5">IR-07 · the only seam</text>

    <!-- in-lane arrows -->
    <line class="lane" x1="236" y1="380" x2="252" y2="380" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>
    <line class="lane" x1="468" y1="380" x2="484" y2="380" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>
    <line class="lane" x1="700" y1="380" x2="716" y2="380" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>
    <line class="lane" x1="932" y1="380" x2="948" y2="380" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>
    <line class="lane" x1="1164" y1="380" x2="1180" y2="380" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>

    <!-- outbound queue -->
    <rect x="720" y="438" width="444" height="68" rx="8" fill="${TOKENS.panel}" stroke="${TOKENS.line}"/>
    <text x="942" y="456" fill="${TOKENS.muted}" text-anchor="middle" font-size="11.5" font-weight="700">Deferred synchronisation queue</text>
    <text x="942" y="472" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">consumption postings held while OrgaTEX is unreachable</text>
    <text x="942" y="487" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">retried on reconnect · idempotent, never double-counted</text>
    <text x="942" y="501" fill="${TOKENS.warn}" text-anchor="middle" font-size="9.5">weighing continues during an outage</text>
    <line class="lane" x1="826" y1="422" x2="826" y2="434" stroke="${TOKENS.steel}" marker-end="url(#ar)"/>

    <!-- ============ DUMMY LANE ============ -->
    <rect x="8" y="538" width="1404" height="76" rx="9" fill="#151a22" stroke="${TOKENS.steel}" stroke-width="1.4" stroke-dasharray="7 5"/>
    <text x="22" y="556" fill="${TOKENS.steel}" font-size="10" font-weight="700" letter-spacing="1.6">TRAINING SUBSTITUTES — PART OF THE PRODUCT, NOT TEST FIXTURES</text>

    <rect x="24" y="564" width="200" height="42" rx="7" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}" stroke-dasharray="4 3"/>
    <text x="124" y="582" fill="${TOKENS.ink}" text-anchor="middle" font-size="11.5" font-weight="700">Dummy OrgaTEX API</text>
    <text x="124" y="597" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">batches · recipe · consumption</text>

    <rect x="240" y="564" width="200" height="42" rx="7" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}" stroke-dasharray="4 3"/>
    <text x="340" y="582" fill="${TOKENS.ink}" text-anchor="middle" font-size="11.5" font-weight="700">Dummy Scale API</text>
    <text x="340" y="597" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">10 Hz SSE · stability · disconnect</text>

    <rect x="456" y="564" width="200" height="42" rx="7" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}" stroke-dasharray="4 3"/>
    <text x="556" y="582" fill="${TOKENS.ink}" text-anchor="middle" font-size="11.5" font-weight="700">Dummy Scanner</text>
    <text x="556" y="597" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">batch · material · lot codes</text>

    <rect x="672" y="564" width="200" height="42" rx="7" fill="${TOKENS.panel2}" stroke="${TOKENS.steel}" stroke-dasharray="4 3"/>
    <text x="772" y="582" fill="${TOKENS.ink}" text-anchor="middle" font-size="11.5" font-weight="700">Dummy Printer</text>
    <text x="772" y="597" fill="${TOKENS.dim}" text-anchor="middle" font-size="9.5">renders ticket · reprint marking</text>

    <!-- repointing note, kept inside the dashed box -->
    <rect x="896" y="564" width="504" height="42" rx="7" fill="${TOKENS.panel}" stroke="${TOKENS.line}" stroke-dasharray="4 3"/>
    <text x="1148" y="581" fill="${TOKENS.muted}" text-anchor="middle" font-size="10.5">Each dummy is reachable only through the adapter</text>
    <text x="1148" y="595" fill="${TOKENS.muted}" text-anchor="middle" font-size="10.5">that would hold the real system. Repointing the</text>
    <text x="1148" y="608" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">adapter swaps dummy for real — nothing above the seam changes.</text>

    <!-- vertical connections: real lane <-> system lane -->
    <path d="M 200 280 L 200 340" fill="none" stroke="${TOKENS.steel}" stroke-width="1.4" marker-end="url(#ar)" stroke-dasharray="5 3"/>
    <text x="206" y="300" fill="${TOKENS.muted}" font-size="9.5">queue / recipe</text>

    <path d="M 406 280 L 406 340" fill="none" stroke="${TOKENS.steel}" stroke-width="1.4" marker-end="url(#ar)" stroke-dasharray="5 3"/>
    <text x="412" y="300" fill="${TOKENS.muted}" font-size="9.5">weight stream</text>

    <path d="M 1291 280 L 1291 340" fill="none" stroke="${TOKENS.steel}" stroke-width="1.4" marker-end="url(#ar)" stroke-dasharray="5 3"/>
    <text x="1300" y="300" fill="${TOKENS.muted}" font-size="9.5">via adapters</text>

    <!-- operator -> UI -->
    <path d="M 122 100 L 122 340" fill="none" stroke="${TOKENS.steel}" stroke-width="1.4" marker-end="url(#ar)"/>
    <!-- supervisor -> UI -->
    <path d="M 334 100 L 334 340" fill="none" stroke="${TOKENS.steel}" stroke-width="1.4" marker-end="url(#ar)"/>
    <!-- consumers -> records -->
    <path d="M 538 100 L 538 310 L 826 310 L 826 340" fill="none" stroke="${TOKENS.dim}" stroke-width="1.1" marker-end="url(#ar)" stroke-dasharray="4 3"/>
    <path d="M 734 100 L 734 302 L 826 302 L 826 340" fill="none" stroke="${TOKENS.dim}" stroke-width="1.1" marker-end="url(#ar)" stroke-dasharray="4 3"/>
    <!-- IT -> system -->
    <path d="M 930 100 L 930 330" fill="none" stroke="${TOKENS.dim}" stroke-width="1.1" marker-end="url(#ar)" stroke-dasharray="4 3"/>

    <!-- dummy repointing -->
    <path d="M 124 538 L 124 530 L 1291 530 L 1291 422" fill="none" stroke="${TOKENS.steel}" stroke-width="1.1" marker-end="url(#ar)" stroke-dasharray="2 4" opacity="0.75"/>
    <path d="M 340 538 L 340 530" fill="none" stroke="${TOKENS.steel}" stroke-width="1.1" marker-end="url(#ar)" stroke-dasharray="2 4" opacity="0.75"/>
  </svg>
</div>

<!-- ══════════════ TABLE ROWS ══════════════ -->
<div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:14px">
  <div class="card">
    <h2>Data crossing the boundary</h2>
    <table>
      <thead><tr><th>Dir</th><th>Flow</th><th>Data</th><th>Guarantee</th></tr></thead>
      <tbody>
        <tr><td><span class="tag t-ok">in</span></td><td>Batch queue</td><td class="dim">batch, order, machine, fabric/lot, shade, count, status</td><td class="dimmer">schema-validated; not <span class="mono">RELEASED</span> ⇒ not selectable</td></tr>
        <tr><td><span class="tag t-ok">in</span></td><td>Recipe</td><td class="dim">per component: code, name, target, unit, tolerance, lot, container, tare</td><td class="dimmer">tolerance &gt; 0 · unit in g/kg · target &gt; 0</td></tr>
        <tr><td><span class="tag t-ok">in</span></td><td>Weight stream</td><td class="dim">fixed-point weight, stability flag, scale id, sequence</td><td class="dimmer">10 Hz · never a float · sequence gaps mark reconnect</td></tr>
        <tr><td><span class="tag t-ok">in</span></td><td>Scan payload</td><td class="dim">barcode string, entity type</td><td class="dimmer">type known · resolves to batch / material / lot</td></tr>
        <tr><td><span class="tag t-ok">in</span></td><td>Operator identity</td><td class="dim">operator id, name, role, auth result</td><td class="dimmer">role exists · session time-boxed</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Consumption</td><td class="dim">batch, actual qty, unit, lot, operator, timestamp, record id</td><td class="dimmer"><strong>idempotent</strong> · retried · queued offline</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Batch status</td><td class="dim">batch id, status</td><td class="dimmer">idempotent, last-writer-wins</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Ticket</td><td class="dim">rendered ticket content</td><td class="dimmer">job recorded · retryable · reprint marked</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Tare</td><td class="dim">tare request</td><td class="dimmer">on scale selection and re-tare</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Audit record</td><td class="dim">action, actor, reason, timestamp, prior state</td><td class="dimmer"><strong>immutable</strong> · exportable · ≥ 5 years</td></tr>
        <tr><td><span class="tag t-warn">out</span></td><td>Weighing record</td><td class="dim">target, actual, operator, scale, lot, container, timestamp, zone</td><td class="dimmer">append-only · fixed-point · immutable on confirm</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Failure boundaries — what happens when each one breaks</h2>
    <table>
      <thead><tr><th>#</th><th>Boundary</th><th>On failure</th></tr></thead>
      <tbody>
        <tr><td class="mono">B-1</td><td>OrgaTEX unreachable</td><td class="dim">Weighing <strong>continues</strong>. Postings queue and retry; depth and age visible. No duplication.</td></tr>
        <tr><td class="mono">B-2</td><td>Contract differs</td><td class="dim">Only the adapter changes (IR-07). Nothing above it depends on the external shape.</td></tr>
        <tr><td class="mono">B-3</td><td>Scale stream drops</td><td class="dim">Detected and weighing <strong>blocked</strong> within 2 s; operator told; auto-reconnect.</td></tr>
        <tr><td class="mono">B-4</td><td>Scale out of calibration</td><td class="dim">Weighing prevented on that scale until calibration is current.</td></tr>
        <tr><td class="mono">B-5</td><td>Stabilised value only</td><td class="dim"><strong style="color:${TOKENS.over}">Guided weighing as drawn is not buildable.</strong> Changes the interaction's shape, not its pixels.</td></tr>
        <tr><td class="mono">B-6</td><td>Unknown barcode</td><td class="dim">Fall back to manual selection/attestation; the fallback is recorded.</td></tr>
        <tr><td class="mono">B-7</td><td>Printer offline</td><td class="dim">The weighing record is already durable; printing fails without losing the weighing.</td></tr>
        <tr><td class="mono">B-8</td><td>Terminal↔API fault</td><td class="dim">Explicit degraded state, never stale numbers presented as live.</td></tr>
        <tr><td class="mono">B-9</td><td>Power loss</td><td class="dim">A confirmed weighing survives; an interrupted session resumes at the component in progress.</td></tr>
        <tr><td class="mono">B-10</td><td>Unauthenticated override</td><td class="dim">Refused and the attempt is audited. No credential sharing.</td></tr>
        <tr><td class="mono">B-11</td><td>Double write-back</td><td class="dim">Posting is idempotent on a stable record id — a replay is a no-op.</td></tr>
      </tbody>
    </table>
    <div style="margin-top:12px;padding:10px 12px;background:${TOKENS.panel2};border-radius:6px;border-left:3px solid ${TOKENS.warn}">
      <div class="eyebrow" style="margin-bottom:4px;color:${TOKENS.warn}">Failure-boundary rule</div>
      <div style="font-size:11.5px;line-height:1.5">
        <strong>No failure at any boundary may produce a silently wrong number.</strong>
        A weight that is not live is shown as not live. A posting that has not landed is shown as
        pending, not confirmed. The prototype's hard-coded
        <span class="mono">ORGATEX · LINKED</span> becomes a real link state —
        <span class="mono">LINKED</span>, <span class="mono">DEGRADED</span> or <span class="mono">OFFLINE</span>.
      </div>
    </div>
  </div>
</div>

<div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:14px">
  <div class="card">
    <h2>Ownership</h2>
    <table>
      <tbody>
        <tr><td class="dimmer" style="width:96px">OrgaTEX owns</td><td class="dim">batches, orders, machines, recipes, tolerances, dyestuff master, shade decision</td></tr>
        <tr><td class="dimmer">FCI owns</td><td class="dim">the recipe rules, the acceptance of tolerances, the compensation rule, the ticket content</td></tr>
        <tr><td class="dimmer">SETEX owns</td><td class="dim">the OrgaTEX product and its interface</td></tr>
        <tr><td class="dimmer">WeighingMS owns</td><td class="dim">the weighing session, the zone judgement, the recorded weighing fact, the ticket, the audit trail</td></tr>
        <tr><td class="dimmer">Nobody owns</td><td class="dim">the dispensing act — it stays manual by design</td></tr>
      </tbody>
    </table>
    <div style="margin-top:12px;padding:10px 12px;background:${TOKENS.panel2};border-radius:6px;border-left:3px solid ${TOKENS.steel}">
      <div class="eyebrow" style="margin-bottom:4px">The one seam</div>
      <div style="font-size:11.5px;line-height:1.5">
        Every external interaction passes through an adapter (BRD IR-07). The adapter owns the
        <em>contract</em>; the dummy or the real system implements it. That is the whole mechanism
        by which a training substitute can be swapped for a real integration without touching the
        domain — and it is why no external API shape is invented anywhere in this build.
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Explicitly out of scope</h2>
    <ul style="font-size:11.5px;line-height:1.55;margin:0;padding-left:16px">
      <li><strong>Dispensing machinery</strong> — no connection, no control (BRD C-03). Excluding it is a constraint, not an omission.</li>
      <li><strong>The dyeing machine</strong> — appears in the breadcrumb and the ticket as data; never called.</li>
      <li><strong>Shade approval and re-dye</strong> — Lab/QA and OrgaTEX. WeighingMS supplies the evidence, it does not make the call.</li>
      <li><strong>A multi-station fleet</strong> — the BRD describes one station. More is a deployment concern, not a different context.</li>
      <li><strong>Any real external API contract</strong> — not invented anywhere in this document.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Open questions raised by the context work</h2>
    <table style="table-layout:fixed">
      <thead><tr><th style="width:52px">#</th><th>Question</th><th style="width:74px">Owner</th></tr></thead>
      <tbody>
        <tr><td class="mono" style="white-space:nowrap">CQ-01</td><td class="dim">Is the ticket printed at the station or at a shared printer?</td><td class="dimmer">FCI</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-02</td><td class="dim">Identity per shift, or per weighing?</td><td class="dimmer">FCI prod.</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-03</td><td class="dim">Can a batch be split across shifts or operators?</td><td class="dimmer">FCI prod.</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-04</td><td class="dim">Two physical scales, or one indicator re-zeroed?</td><td class="dimmer">FCI</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-05</td><td class="dim">Is consumption posted per batch, per component, or per lot?</td><td class="dimmer">FCI/SETEX</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-06</td><td class="dim">Is a rejected posting permanent or retryable?</td><td class="dimmer">FCI/SETEX</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-07</td><td class="dim">Is a dashboard or BI export needed? A new flow, not a new context.</td><td class="dimmer">FCI</td></tr>
        <tr><td class="mono" style="white-space:nowrap">CQ-08</td><td class="dim">Do containers already carry a lot barcode, or is it keyed in?</td><td class="dimmer">FCI prod.</td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="foot">
  Full document: <span class="mono">memory-bank/intents/001-assisted-dyestuff-weighing-station/system-context.md</span> ·
  Sources: BRD v1.1 (<span class="mono">docs/brief.md</span>), prototype (<span class="mono">docs/customize-weighing-station.html</span>), approved requirements ·
  Three question families are kept apart so each keeps its provenance:
  <span class="mono">Q-nn</span> (BRD) · <span class="mono">PQ-nn</span> (prototype) · <span class="mono">CQ-nn</span> (context).
</div>

</div></body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 900 },
      deviceScaleFactor: 1,
    });
    const p = await ctx.newPage();
    const tmp = path.join(OUT, '.tmp-step09.html');
    fs.writeFileSync(tmp, HTML, 'utf8');
    await p.goto('file:///' + tmp.replace(/\\/g, '/'));
    await p.waitForTimeout(400);
    const body = await p.$('body');
    await body.screenshot({ path: path.join(OUT, 'STEP-09-system-context.png') });
    await ctx.close();
    fs.unlinkSync(tmp);
    console.log('  wrote STEP-09-system-context.png');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
