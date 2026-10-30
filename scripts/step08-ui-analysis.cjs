/**
 * Step 8 — Convert the UI/UX into development knowledge.
 *
 * Renders the four evidence artefacts required by the workbook:
 *   evidence/STEP-08-ui-analysis/screen-inventory.png
 *   evidence/STEP-08-ui-analysis/component-inventory.png
 *   evidence/STEP-08-ui-analysis/state-model.png
 *   evidence/STEP-08-ui-analysis/ai-analysis.png
 *
 * The first two are *screenshots of the supplied prototype* (rendered by
 * Playwright, unmodified) with an annotation panel. The last two are
 * generated diagrams built from the prototype's own source of truth.
 *
 * Nothing here redesigns the prototype: the screenshots are the prototype as
 * FCI supplied it, captured at a chosen view/zone state.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PROTO = path.join(ROOT, 'docs', 'customize-weighing-station.html');
const OUT = path.join(ROOT, 'evidence', 'STEP-08-ui-analysis');

// ---------------------------------------------------------------------------
// Shared styling for the generated diagram pages.
// Colours are taken from the prototype's own :root design tokens so the
// evidence reads as one family with the screenshots.
// ---------------------------------------------------------------------------
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

const BASE_CSS = `
  @font-face { font-family: 'P'; src: local('Segoe UI'), local('Arial'); }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    background: ${TOKENS.bezel};
    color: ${TOKENS.ink};
    font-family: 'P', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, 'Cascadia Mono', 'Consolas', monospace; }
  .sheet { padding: 28px 32px 34px; }
  .eyebrow {
    font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
    color: ${TOKENS.steel}; font-weight: 700; margin: 0 0 6px;
  }
  h1 { font-size: 25px; margin: 0 0 4px; font-weight: 650; letter-spacing: -.01em; }
  .sub { color: ${TOKENS.muted}; font-size: 13px; margin: 0 0 22px; line-height: 1.5; }
  h2 {
    font-size: 13px; letter-spacing: .1em; text-transform: uppercase;
    color: ${TOKENS.steel}; margin: 0 0 12px; font-weight: 700;
  }
  .card {
    background: ${TOKENS.panel}; border: 1px solid ${TOKENS.line};
    border-radius: 10px; padding: 16px 18px;
  }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 0 0 18px; }
  .legend span { font-size: 11.5px; color: ${TOKENS.muted}; display: flex; align-items: center; gap: 6px; }
  .sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 10px; font-size: 12.5px; vertical-align: top; }
  th {
    color: ${TOKENS.steel}; font-weight: 700; font-size: 10.5px;
    letter-spacing: .09em; text-transform: uppercase;
    border-bottom: 1px solid ${TOKENS.line};
  }
  td { border-bottom: 1px solid rgba(44,54,68,.55); color: ${TOKENS.ink}; }
  td.dim, .dim { color: ${TOKENS.muted}; }
  td.dimmer { color: ${TOKENS.dim}; }
  .grid { display: grid; gap: 14px; }
  .tag {
    display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em;
    padding: 2px 7px; border-radius: 4px; text-transform: uppercase;
    border: 1px solid currentColor; white-space: nowrap;
  }
  .t-ok { color: ${TOKENS.ok}; } .t-warn { color: ${TOKENS.warn}; }
  .t-over { color: ${TOKENS.over}; } .t-steel { color: ${TOKENS.steel}; }
  .t-muted { color: ${TOKENS.dim}; }
  ul { margin: 0; padding-left: 17px; }
  li { font-size: 12.5px; color: ${TOKENS.ink}; margin-bottom: 5px; line-height: 1.45; }
  li::marker { color: ${TOKENS.steel}; }
  .foot {
    margin-top: 26px; padding-top: 12px; border-top: 1px solid ${TOKENS.line};
    font-size: 11px; color: ${TOKENS.dim};
  }
`;

/** Build a standalone HTML page from a body fragment. */
function page(title, bodyHtml, extraCss = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title><style>${BASE_CSS}${extraCss}</style></head>
<body><div class="sheet">${bodyHtml}</div></body></html>`;
}

/** Write a temp HTML file and screenshot it at a fixed viewport width. */
async function shoot(browser, html, file, width = 1500) {
  const tmp = path.join(OUT, `.tmp-${file}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  const p = await ctx.newPage();
  await p.goto('file:///' + tmp.replace(/\\/g, '/'));
  await p.waitForTimeout(320);
  const el = await p.$('body');
  await el.screenshot({ path: path.join(OUT, file) });
  await ctx.close();
  fs.unlinkSync(tmp);
  console.log('  wrote', file);
}

/** Screenshot the supplied prototype itself, at a given view + zone. */
async function shootProto(browser, file, { view = 'weigh', click = null, settle = 0, width = 1680, height = 1050 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file:///' + PROTO.replace(/\\/g, '/'));
  await p.waitForTimeout(200);
  if (view !== 'weigh') {
    await p.click(`.seg button[data-view="${view}"]`);
    await p.waitForTimeout(150);
  }
  if (click) { await p.click(click); await p.waitForTimeout(250); }
  if (settle) await p.waitForTimeout(settle);
  // Hide the marketing "notes" block and footer: they are commentary for the
  // FCI meeting, not part of the operator terminal being specified.
  await p.addStyleTag({
    content: '.notes, .foot { display: none !important; } .hmi { min-height: 100vh; }',
  });
  await p.waitForTimeout(120);
  await p.screenshot({ path: path.join(OUT, file) });
  await ctx.close();
  console.log('  wrote', file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // -----------------------------------------------------------------
    // 1. screen-inventory.png — the three views of the prototype.
    // -----------------------------------------------------------------
    console.log('screen-inventory');
    {
      const shots = [];
      const tmp = path.join(OUT, '.tmp-si');
      fs.mkdirSync(tmp, { recursive: true });

      const views = [
        {
          id: 'queue',
          title: 'View 1 · Batch queue',
          dom: '#v-queue',
          cond: 'Entry: station idle / F3 "Next batch" / batch card scanned',
          notes:
            'Queue of batches received from OrgaTEX. Row click or scanner selects a batch. ' +
            'Columns: Batch, Order, Machine, Fabric/lot, Shade, Comp., Status. One row carries the ' +
            '<span class="tag now">WEIGHING</span> state; others are QUEUED.',
        },
        {
          id: 'weigh',
          title: 'View 2 · Weighing station',
          dom: '#v-weigh',
          cond: 'Entry: a batch is selected and a recipe is loaded',
          notes:
            'Left rail = recipe components with per-component state. Right = live weight readout, ' +
            'tolerance band bar, status line, surplus panel, and the action row ' +
            '(OK·Confirm F1, Re-tare F2, Quit F4, Supervisor override).',
        },
        {
          id: 'done',
          title: 'View 3 · Batch complete',
          dom: '#v-done',
          cond: 'Entry: the last component of the recipe is confirmed',
          notes:
            'Batch summary (components weighed, all-within-tolerance, total dispensed, elapsed, ' +
            'operator, OrgaTEX write-back confirmation) beside the rendered weighing ticket. ' +
            'Actions: Print ticket (F1), Next batch (F3).',
        },
      ];

      for (const v of views) {
        const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
        const p = await ctx.newPage();
        await p.goto('file:///' + PROTO.replace(/\\/g, '/'));
        await p.waitForTimeout(200);
        await p.click(`.seg button[data-view="${v.id}"]`);
        await p.waitForTimeout(200);
        await p.addStyleTag({ content: '.notes, .foot { display: none !important; }' });
        const f = path.join(tmp, `${v.id}.png`);
        // Capture only the device screen (the operator terminal), not the
        // surrounding review page — the terminal is what is being specified.
        const device = await p.$('.device');
        await device.screenshot({ path: f });
        await ctx.close();
        shots.push({ ...v, file: f });
      }

      // Compose: three panels in a row, each with the screenshot and the spec.
      const body = `
        <p class="eyebrow">Step 8 · UI/UX analysis · WeighingMS</p>
        <h1>Screen inventory</h1>
        <p class="sub">
          The three operator-terminal screens defined by <span class="mono">docs/customize-weighing-station.html</span>.
          Screenshots are the supplied prototype rendered unchanged by Playwright (Chromium).
          The prototype's meeting-notes block is hidden because it is commentary, not screen.
        </p>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
          ${shots
            .map(
              (v) => `
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px">
                <h2 style="margin:0;font-size:11.5px">${v.title}</h2>
              </div>
              <span class="mono dim" style="font-size:10.5px;display:block;margin-bottom:8px">DOM: ${v.dom}</span>
              <img src="${v.file.replace(/\\/g, '/')}" style="width:100%;display:block;border:1px solid ${TOKENS.line};border-radius:5px" />
              <div style="margin-top:10px">
                <div class="eyebrow" style="margin-bottom:3px;font-size:9.5px">Entry condition</div>
                <div style="font-size:11.5px;line-height:1.45;color:${TOKENS.ink}">${v.cond}</div>
              </div>
              <div style="margin-top:9px">
                <div class="eyebrow" style="margin-bottom:3px;font-size:9.5px">What the screen does</div>
                <div style="font-size:11.5px;line-height:1.45;color:${TOKENS.muted}">${v.notes}</div>
              </div>
            </div>`
            )
            .join('')}
        </div>
        <div class="card">
          <h2>Persistent chrome on every screen</h2>
          <table>
            <thead><tr><th>Region</th><th>Contents</th><th>Extracted from</th></tr></thead>
            <tbody>
              <tr>
                <td class="mono">.topbar</td>
                <td>Brandmark “WeighingMS · STATION 01” · batch/order/machine crumb (B-24187 · SO-9931 · JET-04) · operator chip (R. Karim · Shift A)</td>
                <td class="dimmer mono">prototype .topbar</td>
              </tr>
              <tr>
                <td class="mono">.strip</td>
                <td>SCALE 3 kg · READY · SCALE 32 kg · READY · SCANNER · PRINTER · ORGATEX · LINKED 07:41 · language · clock</td>
                <td class="dimmer mono">prototype .strip</td>
              </tr>
              <tr>
                <td class="mono">.seg</td>
                <td>View switcher: Queue / Weigh / Done — prototype navigation only; the built station drives views from real state</td>
                <td class="dimmer mono">prototype .seg</td>
              </tr>
              <tr>
                <td class="mono">.actions .fn</td>
                <td>Function-key badges: F1 Confirm/Print · F2 Re-tare · F3 Next batch · F4 Quit (override carries no F-key)</td>
                <td class="dimmer mono">prototype .actions</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="foot">
          Screens are reproduced, not redesigned. Source: ui-analysis.md §1–§2.
        </div>`;

      await shoot(browser, page('Screen inventory', body), 'screen-inventory.png', 1500);
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // -----------------------------------------------------------------
    // 2. component-inventory.png — the recipe component rail + data model.
    // -----------------------------------------------------------------
    console.log('component-inventory');
    {
      const tmp = path.join(OUT, '.tmp-ci');
      fs.mkdirSync(tmp, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      await p.goto('file:///' + PROTO.replace(/\\/g, '/'));
      await p.waitForTimeout(250);
      // Capture the rail in its seeded state: 2 done, 1 active, 2 pending.
      const rail = await p.$('.rail');
      await rail.screenshot({ path: path.join(tmp, 'rail.png') });
      await ctx.close();

      const railFile = path.join(tmp, 'rail.png').replace(/\\/g, '/');

      const rows = [
        ['Remazol Brill. Blue RSPL', 'DYE-1180', '#1f4fa8', '1240.0 g', '± 6.0 g', '3 kg precision', '1600 g', 'done', '1241.5', '2026-0341', 'C-09', '214 g'],
        ['Remazol Red RB', 'DYE-2204', '#b8253a', '386.0 g', '± 2.0 g', '3 kg precision', '520 g', 'done', '385.4', '2026-0298', 'C-11', '214 g'],
        ['Remazol Yellow RGB', 'DYE-4471', '#d9a520', '94.0 g', '± 0.5 g', '3 kg precision', '125 g', 'active', '—', '2026-0387', 'C-12', '214 g'],
        ['Sodium Sulphate', 'AUX-0101', '#c9d2dc', '24.000 kg', '± 0.120 kg', '32 kg floor', '32 kg', 'pending', '—', '2026-0112', 'D-03', '1.850 kg'],
        ['Soda Ash', 'AUX-0107', '#e4eaf0', '9.600 kg', '± 0.048 kg', '32 kg floor', '14 kg', 'pending', '—', '2026-0155', 'D-05', '1.850 kg'],
      ];

      const stateTag = (s) =>
        s === 'done' ? '<span class="tag t-ok">done</span>' :
        s === 'active' ? '<span class="tag t-warn">active</span>' :
        '<span class="tag t-muted">pending</span>';

      const body = `
        <p class="eyebrow">Step 8 · UI/UX analysis · WeighingMS</p>
        <h1>Component inventory</h1>
        <p class="sub">
          The recipe rail is the spine of the weighing screen: it shows every component of the loaded recipe,
          its target, and its <em>state</em>. It is also the selector — tapping a not-yet-done component
          changes which component the scale is weighing.
        </p>

        <div class="grid" style="grid-template-columns:0.62fr 1.38fr;margin-bottom:16px">
          <div class="card">
            <h2>As rendered by the prototype</h2>
            <img src="${railFile}" style="width:100%;display:block;border:1px solid ${TOKENS.line};border-radius:6px" />
            <p style="font-size:11.5px;color:${TOKENS.muted};margin:10px 0 0;line-height:1.5">
              Seeded state: Blue RSPL and Red RB are <strong style="color:${TOKENS.ok}">✓ done</strong>,
              Yellow RGB is <strong style="color:${TOKENS.warn}">WEIGHING</strong>, the two auxiliaries are
              <strong style="color:${TOKENS.dim}">PENDING</strong>. Header reads “2 of 5 components weighed”.
            </p>
            <div style="margin-top:12px;padding-top:11px;border-top:1px solid ${TOKENS.line}">
              <div class="eyebrow" style="margin-bottom:5px">The rail is also the selector</div>
              <div style="font-size:11.5px;line-height:1.5;color:${TOKENS.muted}">
                Clicking a component that is not <span class="mono">done</span> makes it active and returns the
                previous active component to <span class="mono">pending</span>, resetting the weight to zero.
                A component already <span class="mono">done</span> cannot be re-opened — the prototype returns
                early from <span class="mono">select()</span>.
              </div>
            </div>
          </div>
          <div class="card">
            <h2>Component record — fields the prototype carries</h2>
            <table>
              <thead><tr>
                <th>Field</th><th>Meaning</th><th>Source in prototype</th>
              </tr></thead>
              <tbody>
                <tr><td class="mono">id</td><td>Stable component identity within the recipe</td><td class="dimmer mono">c.id</td></tr>
                <tr><td class="mono">name</td><td>Human name of the dyestuff / auxiliary</td><td class="dimmer mono">c.name</td></tr>
                <tr><td class="mono">code</td><td>Material code (DYE-#### for dyestuff, AUX-#### for auxiliary)</td><td class="dimmer mono">c.code</td></tr>
                <tr><td class="mono">color</td><td>Swatch colour for rapid visual identification</td><td class="dimmer mono">c.color</td></tr>
                <tr><td class="mono">target</td><td>Quantity required by the recipe</td><td class="dimmer mono">c.target</td></tr>
                <tr><td class="mono">unit</td><td><span class="mono">g</span> or <span class="mono">kg</span> — drives decimal places (1 or 3)</td><td class="dimmer mono">c.unit</td></tr>
                <tr><td class="mono">tol</td><td>Allowed deviation around target</td><td class="dimmer mono">c.tol</td></tr>
                <tr><td class="mono">scale</td><td>Scale the component must be weighed on</td><td class="dimmer mono">c.scale</td></tr>
                <tr><td class="mono">max</td><td>Scale capacity — the denominator of the progress bar</td><td class="dimmer mono">c.max</td></tr>
                <tr><td class="mono">state</td><td><span class="mono">pending</span> / <span class="mono">active</span> / <span class="mono">done</span></td><td class="dimmer mono">c.state</td></tr>
                <tr><td class="mono">actual</td><td>Dispensed weight, written on confirm (null until then)</td><td class="dimmer mono">c.actual</td></tr>
                <tr><td class="mono">lot</td><td>Batch/lot number of the material used</td><td class="dimmer mono">c.lot</td></tr>
                <tr><td class="mono">cont</td><td>Container the material is drawn from</td><td class="dimmer mono">c.cont</td></tr>
                <tr><td class="mono">tare</td><td>Container tare weight, subtracted before weighing</td><td class="dimmer mono">c.tare</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>Seeded recipe — B-24187 · SO-9931 · JET-04 · Teal 4C</h2>
          <table>
            <thead><tr>
              <th>Component</th><th>Code</th><th>Swatch</th><th>Target</th><th>Tolerance</th>
              <th>Scale</th><th>Scale max</th><th>State</th><th>Actual</th><th>Lot</th><th>Container</th><th>Tare</th>
            </tr></thead>
            <tbody>
              ${rows
                .map(
                  (r) => `<tr>
                    <td>${r[0]}</td><td class="mono dim">${r[1]}</td>
                    <td><span class="sw" style="background:${r[2]};width:14px;height:14px"></span></td>
                    <td class="mono">${r[3]}</td><td class="mono dim">${r[4]}</td>
                    <td class="dim">${r[5]}</td><td class="mono dimmer">${r[6]}</td>
                    <td>${stateTag(r[7])}</td>
                    <td class="mono">${r[8]}</td><td class="mono dimmer">${r[9]}</td>
                    <td class="mono dimmer">${r[10]}</td><td class="mono dimmer">${r[11]}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
          <div class="legend" style="margin:14px 0 0">
            <span><span class="sw" style="background:${TOKENS.ok}"></span> done — terminal, cannot be re-selected</span>
            <span><span class="sw" style="background:${TOKENS.warn}"></span> active — currently on the scale</span>
            <span><span class="sw" style="background:${TOKENS.dim}"></span> pending — awaiting weighing</span>
          </div>
        </div>

        <div class="foot">
          Unit mixing is deliberate: dyestuffs weigh in g (1 dp), auxiliaries in kg (3 dp). The same
          <span class="mono">fmt(v, unit)</span> rule formats readout, tolerance caption and rail.
          Source: ui-analysis.md §5.
        </div>`;

      await shoot(browser, page('Component inventory', body), 'component-inventory.png', 1500);
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // -----------------------------------------------------------------
    // 3. state-model.png — component states, weight zones, transitions.
    // -----------------------------------------------------------------
    console.log('state-model');
    {
      const body = `
        <p class="eyebrow">Step 8 · UI/UX analysis · WeighingMS</p>
        <h1>State model</h1>
        <p class="sub">
          Two orthogonal state dimensions drive the weighing screen: the <em>component</em> lifecycle
          (pending → active → done) and the <em>weight zone</em> of the live readout (under / near / ok / over).
          The zone decides the status line, the colour of the readout and bar, and whether OK is enabled.
        </p>

        <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
          <div class="card">
            <h2>Dimension A — component lifecycle</h2>
            <svg viewBox="0 0 620 220" style="width:100%">
              <defs>
                <marker id="ar" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
                  <path d="M0,0 L7,3.2 L0,6.4 Z" fill="${TOKENS.steel}"/>
                </marker>
              </defs>
              <rect x="14" y="80" width="140" height="52" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.line}"/>
              <text x="84" y="103" fill="${TOKENS.dim}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1">PENDING</text>
              <text x="84" y="120" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">awaiting weighing</text>

              <rect x="240" y="80" width="140" height="52" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.warn}"/>
              <text x="310" y="103" fill="${TOKENS.warn}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1">ACTIVE</text>
              <text x="310" y="120" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">on the scale</text>

              <rect x="466" y="80" width="140" height="52" rx="9" fill="${TOKENS.panel2}" stroke="${TOKENS.ok}"/>
              <text x="536" y="103" fill="${TOKENS.ok}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1">DONE</text>
              <text x="536" y="120" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">terminal</text>

              <line x1="156" y1="106" x2="236" y2="106" stroke="${TOKENS.steel}" stroke-width="1.6" marker-end="url(#ar)"/>
              <text x="196" y="96" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">T-2 select</text>

              <line x1="382" y1="106" x2="462" y2="106" stroke="${TOKENS.steel}" stroke-width="1.6" marker-end="url(#ar)"/>
              <text x="422" y="96" fill="${TOKENS.muted}" text-anchor="middle" font-size="10">T-4 confirm</text>

              <path d="M310 132 C 310 176, 536 176, 536 136" fill="none" stroke="${TOKENS.dim}" stroke-width="1.4" stroke-dasharray="4 4" marker-end="url(#ar)"/>
              <text x="423" y="192" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">T-3 reselect — the previous active component returns to pending</text>

              <path d="M536 78 C 536 40, 84 40, 84 76" fill="none" stroke="${TOKENS.over}" stroke-width="1.4" stroke-dasharray="4 4" marker-end="url(#ar)"/>
              <text x="310" y="30" fill="${TOKENS.over}" text-anchor="middle" font-size="10">T-5 “done” is terminal — the prototype's select() returns early; done components cannot be re-opened</text>
            </svg>
          </div>

          <div class="card">
            <h2>Dimension B — weight zone</h2>
            <svg viewBox="0 0 620 250" style="width:100%">
              <defs>
                <marker id="ar2" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
                  <path d="M0,0 L7,3.2 L0,6.4 Z" fill="${TOKENS.steel}"/>
                </marker>
              </defs>
              <!-- zone label row -->
              <text x="110" y="34" fill="${TOKENS.ink}" text-anchor="middle" font-size="11" font-weight="700">UNDER</text>
              <text x="110" y="50" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">v &lt; target×0.9</text>

              <text x="278" y="34" fill="${TOKENS.warn}" text-anchor="middle" font-size="11" font-weight="700">NEAR</text>
              <text x="278" y="50" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">target×0.9 ≤ v &lt; target−tol</text>

              <text x="404" y="34" fill="${TOKENS.ok}" text-anchor="middle" font-size="11" font-weight="700">OK</text>
              <text x="404" y="50" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">target−tol ≤ v ≤ target+tol</text>

              <text x="528" y="34" fill="${TOKENS.over}" text-anchor="middle" font-size="11" font-weight="700">OVER</text>
              <text x="528" y="50" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">v &gt; target+tol</text>

              <!-- the numeric axis -->
              <line x1="40" y1="132" x2="580" y2="132" stroke="${TOKENS.line}" stroke-width="1.5"/>
              <!-- under / near regions -->
              <rect x="40" y="112" width="158" height="20" fill="${TOKENS.dim}" opacity="0.10"/>
              <rect x="198" y="112" width="96" height="20" fill="${TOKENS.warn}" opacity="0.13"/>
              <!-- tolerance band -->
              <rect x="294" y="112" width="220" height="20" fill="${TOKENS.ok}" opacity="0.20"/>
              <line x1="294" y1="106" x2="294" y2="138" stroke="${TOKENS.ok}" stroke-width="1.4" stroke-dasharray="3 3"/>
              <line x1="514" y1="106" x2="514" y2="138" stroke="${TOKENS.ok}" stroke-width="1.4" stroke-dasharray="3 3"/>
              <!-- target marker -->
              <line x1="404" y1="102" x2="404" y2="142" stroke="${TOKENS.ink}" stroke-width="2.2"/>
              <text x="404" y="94" fill="${TOKENS.ink}" text-anchor="middle" font-size="10" font-weight="700">target</text>

              <!-- band annotation -->
              <text x="404" y="158" fill="${TOKENS.ok}" text-anchor="middle" font-size="10" font-weight="700">target ± tol</text>

              <!-- axis endpoints -->
              <text x="40" y="178" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">0</text>
              <text x="580" y="178" fill="${TOKENS.dim}" text-anchor="middle" font-size="10">weight →</text>

              <!-- formula -->
              <rect x="40" y="196" width="540" height="38" rx="6" fill="${TOKENS.panel2}" stroke="${TOKENS.line}"/>
              <text x="310" y="220" fill="${TOKENS.ink}" text-anchor="middle" font-size="11" font-family="ui-monospace, Consolas, monospace">zone(v) — evaluated on every weight tick</text>
            </svg>
            <table style="margin-top:8px">
              <thead><tr><th>Zone</th><th>Status line text</th><th>OK enabled</th><th>Colour token</th></tr></thead>
              <tbody>
                <tr><td><span class="tag t-muted">under</span></td><td class="dim">DISPENSE — <span class="mono">n</span> REMAINING</td><td>no</td><td class="mono dimmer">--hmi-ink</td></tr>
                <tr><td><span class="tag t-warn">near</span></td><td class="dim">DISPENSE — <span class="mono">n</span> REMAINING</td><td>no</td><td class="mono dimmer">--warn</td></tr>
                <tr><td><span class="tag t-ok">ok</span></td><td class="dim">WITHIN TOLERANCE — PRESS OK TO CONFIRM</td><td><strong style="color:${TOKENS.ok}">yes</strong></td><td class="mono dimmer">--ok</td></tr>
                <tr><td><span class="tag t-over">over</span></td><td class="dim">OVER TOLERANCE — SURPLUS +<span class="mono">n</span></td><td>no</td><td class="mono dimmer">--over</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <h2>Zone → surface mapping (exactly as the prototype applies it)</h2>
          <table>
            <thead><tr><th>Element</th><th>Attribute set</th><th>under</th><th>near</th><th>ok</th><th>over</th></tr></thead>
            <tbody>
              <tr><td class="mono">#cell-live</td><td class="mono dimmer">data-zone</td><td>--hmi-ink</td><td>--warn</td><td>--ok</td><td>--over</td></tr>
              <tr><td class="mono">#bar</td><td class="mono dimmer">data-zone</td><td>--hmi-ink</td><td>--warn</td><td>--ok</td><td>--over</td></tr>
              <tr><td class="mono">#status</td><td class="mono dimmer">data-zone</td><td>--hmi-ink</td><td>--warn</td><td>--ok</td><td>--over</td></tr>
              <tr><td class="mono">#surplus</td><td class="mono dimmer">class</td><td>hidden</td><td>hidden</td><td>hidden</td><td>visible</td></tr>
              <tr><td class="mono">#btn-ok</td><td class="mono dimmer">disabled</td><td>true</td><td>true</td><td>false</td><td>true</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Transitions T-1 … T-10</h2>
          <table>
            <thead><tr><th>#</th><th>Trigger</th><th>From</th><th>To</th><th>Effect in the prototype</th></tr></thead>
            <tbody>
              <tr><td class="mono">T-1</td><td>Scan a batch card / click a queue row / F3</td><td class="dim">View 1 queue</td><td class="dim">View 2 weigh</td><td>Recipe loads, first component becomes active</td></tr>
              <tr><td class="mono">T-2</td><td>Click a non-done component in the rail</td><td class="dim">active = A</td><td class="dim">active = B</td><td>A returns to pending; B becomes active; weight resets to 0</td></tr>
              <tr><td class="mono">T-3</td><td>Re-tare (F2)</td><td class="dim">any weight</td><td class="dim">weight = 0</td><td>Stops the ramp, clears the readout and the bar</td></tr>
              <tr><td class="mono">T-4</td><td>OK · Confirm (F1) while zone = ok</td><td class="dim">active</td><td class="dim">done</td><td>actual = now; next pending component is selected automatically</td></tr>
              <tr><td class="mono">T-5</td><td>Click a component already done</td><td class="dim">done</td><td class="dim">done</td><td>Ignored — <span class="mono">select()</span> returns early</td></tr>
              <tr><td class="mono">T-6</td><td>Confirm the last pending component</td><td class="dim">View 2 weigh</td><td class="dim">View 3 done</td><td>Summary and ticket shown</td></tr>
              <tr><td class="mono">T-7</td><td>Live weight crosses a zone boundary</td><td class="dim">zone A</td><td class="dim">zone B</td><td>Colour, status text and OK enablement update</td></tr>
              <tr><td class="mono">T-8</td><td>Zone becomes over</td><td class="dim">surplus hidden</td><td class="dim">surplus visible</td><td>Surplus panel offers a recalculation proposal</td></tr>
              <tr><td class="mono">T-9</td><td>Supervisor override pressed</td><td class="dim">zone over</td><td class="dim">override requested</td><td>Status line reads “OVERRIDE REQUESTED — AWAITING SUPERVISOR”</td></tr>
              <tr><td class="mono">T-10</td><td>Print ticket (F1) / Next batch (F3) in View 3</td><td class="dim">View 3 done</td><td class="dim">print / queue</td><td>Print job queued; F3 returns to View 1</td></tr>
            </tbody>
          </table>
        </div>

        <div class="foot">
          Zone thresholds and the "done is terminal" guard are read directly from the prototype's
          <span class="mono">zone()</span> and <span class="mono">select()</span> functions.
          Source: ui-analysis.md §4 and §7.
        </div>`;

      await shoot(browser, page('State model', body), 'state-model.png', 1500);
    }

    // -----------------------------------------------------------------
    // 4. ai-analysis.png — the analysis summary: rules, assumptions, questions.
    // -----------------------------------------------------------------
    console.log('ai-analysis');
    {
      const body = `
        <p class="eyebrow">Step 8 · UI/UX analysis · WeighingMS</p>
        <h1>Analysis summary</h1>
        <p class="sub">
          What the prototype <em>decides</em> (rules to reproduce), what it <em>assumes</em> without saying so
          (and which therefore must be confirmed), and what it <em>cannot answer</em> (and which therefore
          must stay open questions into construction).
        </p>

        <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
          <div class="card">
            <h2>Business rules extracted from the prototype's JavaScript</h2>
            <table>
              <thead><tr><th>#</th><th>Rule</th></tr></thead>
              <tbody>
                <tr><td class="mono">BR-1</td><td>Zone boundaries are computed from the <em>active</em> component's target and tolerance</td></tr>
                <tr><td class="mono">BR-2</td><td>OK is enabled only while zone = ok; there is no other path to confirmation</td></tr>
                <tr><td class="mono">BR-3</td><td>Confirming writes the live weight to <span class="mono">actual</span> and marks the component done</td></tr>
                <tr><td class="mono">BR-4</td><td>Confirming advances to the <em>first pending</em> component in recipe order</td></tr>
                <tr><td class="mono">BR-5</td><td>Selecting a component resets the weight to zero</td></tr>
                <tr><td class="mono">BR-6</td><td>A done component cannot be re-selected</td></tr>
                <tr><td class="mono">BR-7</td><td>Exactly one component is active at a time</td></tr>
                <tr><td class="mono">BR-8</td><td>Decimal places are 1 for g and 3 for kg</td></tr>
                <tr><td class="mono">BR-9</td><td>The progress bar is scaled against the scale's capacity, not the target</td></tr>
                <tr><td class="mono">BR-10</td><td>The tolerance band is drawn from (target−tol)/max to (target+tol)/max</td></tr>
                <tr><td class="mono">BR-11</td><td>“Still to weigh” is max(0, target − now)</td></tr>
                <tr><td class="mono">BR-12</td><td>The surplus panel appears only when zone = over</td></tr>
                <tr><td class="mono">BR-13</td><td>Surplus proposal scales the remaining components by 1.026</td></tr>
                <tr><td class="mono">BR-14</td><td>Override does not confirm — it only raises a request</td></tr>
                <tr><td class="mono">BR-15</td><td>The scale is chosen per component, not by the operator</td></tr>
                <tr><td class="mono">BR-16</td><td>Component count in the rail header counts only done components</td></tr>
                <tr><td class="mono">BR-17</td><td>The weigh ramp is fast first, easing off as the target approaches</td></tr>
                <tr><td class="mono">BR-18</td><td>“Simulate ok” lands at target + 0.4×tol; “simulate over” at target + 4.8×tol</td></tr>
                <tr><td class="mono">BR-19</td><td>prefers-reduced-motion skips the ramp and jumps straight to the landing value</td></tr>
                <tr><td class="mono">BR-20</td><td>Batch completion is reached when no pending component remains</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <div class="card" style="margin-bottom:14px">
              <h2>Assumptions the prototype represents but does not state</h2>
              <table>
                <thead><tr><th>#</th><th>Assumption</th><th>Risk</th></tr></thead>
                <tbody>
                  <tr><td class="mono">P-1</td><td>Weight can be read continuously, not only as a stabilised value</td><td><span class="tag t-over">blocking</span></td></tr>
                  <tr><td class="mono">P-2</td><td>One operator weighs one component at a time</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-3</td><td>The queue is owned by OrgaTEX, not by the station</td><td><span class="tag t-over">blocking</span></td></tr>
                  <tr><td class="mono">P-4</td><td>Surplus compensation means recalculating the remainder</td><td><span class="tag t-over">blocking</span></td></tr>
                  <tr><td class="mono">P-5</td><td>One container holds one component; containers are identified (C-09, D-03…)</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-6</td><td>Lot numbers are captured per component at the station</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-7</td><td>Tolerances come from the recipe, per dyestuff and per quantity</td><td><span class="tag t-over">blocking</span></td></tr>
                  <tr><td class="mono">P-8</td><td>The scale is selected automatically from the component's quantity</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-9</td><td>A supervisor can override a tolerance failure</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-10</td><td>Actual consumption is written back to OrgaTEX and confirmed</td><td><span class="tag t-over">blocking</span></td></tr>
                  <tr><td class="mono">P-11</td><td>Operators are identified individually for traceability</td><td><span class="tag t-muted">medium</span></td></tr>
                  <tr><td class="mono">P-12</td><td>The interface language is English</td><td><span class="tag t-muted">low</span></td></tr>
                  <tr><td class="mono">P-13</td><td>Ticket content as drawn is sufficient (it is explicitly invented)</td><td><span class="tag t-warn">high</span></td></tr>
                  <tr><td class="mono">P-14</td><td>The operator keeps the whole recipe's components on hand at the station</td><td><span class="tag t-muted">medium</span></td></tr>
                </tbody>
              </table>
            </div>

            <div class="card">
              <h2>Questions the prototype cannot answer — carried forward</h2>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">
                ${[
                  ['Q-01', 'Which OrgaTEX data is readable — queue, recipe, master, tolerances, tare, lot?'],
                  ['Q-02', 'What can be written back, and does OrgaTEX accept actual consumption?'],
                  ['Q-03', 'If OrgaTEX is unreachable, does weighing continue offline?'],
                  ['Q-04', 'Which scale models and protocol?'],
                  ['Q-05', 'What is the auto-selection threshold between the 3 kg and 32 kg scales?'],
                  ['Q-06', 'Continuous weight, or stabilised value only?'],
                  ['Q-07', 'How are tolerances defined, by whom, and do they come from OrgaTEX?'],
                  ['Q-08', 'What does “surplus compensation” actually mean operationally?'],
                  ['Q-09', 'What happens when an overdose cannot be compensated?'],
                  ['Q-10', 'Does one container hold one component or a whole recipe?'],
                  ['Q-11', 'How are dyestuff lot numbers captured?'],
                  ['Q-12', 'Which ticket printer, and what exactly is printed?'],
                  ['Q-13', 'Who may override a tolerance failure, and is it logged?'],
                  ['Q-14', 'What is the interface language?'],
                  ['Q-15', 'Do operators log in individually, and is per-operator traceability required?'],
                  ['Q-16', 'What is the retention period for weighing records?'],
                  ['Q-17', 'How are corrections and re-weighs recorded?'],
                  ['Q-18', 'What is the acceptable downtime and offline tolerance for the station?'],
                ]
                  .map(
                    ([id, q]) =>
                      `<div style="font-size:11.5px;line-height:1.45;padding:5px 0;border-bottom:1px solid rgba(44,54,68,.5)">
                        <span class="mono" style="color:${TOKENS.steel};font-weight:700">${id}</span>
                        <span style="color:${TOKENS.ink}"> ${q}</span>
                      </div>`
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Build implications</h2>
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div>
              <div class="eyebrow" style="color:${TOKENS.ok}">Must reproduce exactly</div>
              <ul>
                <li>The three views and their entry conditions</li>
                <li>The four weight zones and their thresholds</li>
                <li>OK gated on zone = ok</li>
                <li>Confirm advances to first pending component</li>
                <li>Done is terminal</li>
                <li>g / kg decimal rules (1 dp / 3 dp)</li>
                <li>Progress bar scaled to scale capacity</li>
                <li>Function keys F1–F4</li>
              </ul>
            </div>
            <div>
              <div class="eyebrow" style="color:${TOKENS.warn}">Must build beyond the mockup</div>
              <ul>
                <li>Real APIs behind every value shown</li>
                <li>A 10 Hz weight stream, not a scripted ramp</li>
                <li>Persist actual consumption, operator and lot</li>
                <li>Idempotent write-back to OrgaTEX</li>
                <li>Peripheral failure handling and reconnection</li>
                <li>Offline queueing with retry</li>
                <li>Supervisor override with an audit record</li>
              </ul>
            </div>
            <div>
              <div class="eyebrow" style="color:${TOKENS.over}">Must NOT carry over</div>
              <ul>
                <li>The hard-coded component array</li>
                <li>The in-page simulated ramp as the weight source</li>
                <li>The “Label content is invented” ticket as a real contract</li>
                <li>Meeting-notes and pinned-question chrome</li>
                <li>Hard-coded OrgaTEX “LINKED” status</li>
                <li>Any invented real OrgaTEX endpoint shape</li>
              </ul>
            </div>
            <div>
              <div class="eyebrow" style="color:${TOKENS.steel}">Artefacts to carry into construction</div>
              <ul>
                <li>ui-analysis.md §10 — BR-1…BR-20 as the behaviour contract</li>
                <li>ui-analysis.md §11 — P-1…P-14 as assumptions to validate</li>
                <li>ui-analysis.md §12 — Q-01…Q-18 as open questions</li>
                <li>Design tokens as CSS custom properties</li>
                <li>The synthetic ramp as a Dummy Scale behaviour</li>
                <li>Zone thresholds as the tolerance engine's core</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="foot">
          Prototype: <span class="mono">docs/customize-weighing-station.html</span> ·
          BRD: <span class="mono">docs/brief.md</span> (v1.1, FCI) ·
          Full analysis: <span class="mono">memory-bank/intents/001-assisted-dyestuff-weighing-station/ui-analysis.md</span>
        </div>`;

      await shoot(browser, page('Analysis summary', body), 'ai-analysis.png', 1500);
    }
  } finally {
    await browser.close();
  }

  console.log('\nStep 8 evidence complete.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
