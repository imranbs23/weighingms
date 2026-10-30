/**
 * Render the bolt plan as a dependency map image for Checkpoint 3.
 *
 * The map is generated from the real bolt files, so it cannot disagree with
 * the plan. Layout is a two-column flow: the leaf seams on the left, the
 * core in the middle, the outputs on the right — which is the order the
 * bolts actually execute in.
 *
 * Usage: node scripts/step12-bolt-map.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BOLTS_DIR = path.join(ROOT, 'memory-bank', 'bolts');
const OUT = path.join(ROOT, 'evidence');

// ── Read the plan ────────────────────────────────────────────────────────
const bolts = [];
for (const dir of fs.readdirSync(BOLTS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(BOLTS_DIR, dir.name, 'bolt.md');
  if (!fs.existsSync(file)) continue;
  const t = fs.readFileSync(file, 'utf8');

  const listOf = (key) => {
    const m = new RegExp('^' + key + ':\\n((?:  - .+\\n?)*)', 'm').exec(t);
    return m ? m[1].split('\n').filter(Boolean).map((l) => l.replace(/^\s*-\s+/, '')) : [];
  };

  bolts.push({
    id: dir.name,
    n: Number(dir.name.slice(0, 3)),
    unit: /^unit:\s*(\S+)/m.exec(t)?.[1],
    type: /^type:\s*(\S+)/m.exec(t)?.[1],
    stories: listOf('stories'),
    requires: listOf('requires_bolts'),
    objective: (/^## Objective\n\n(.+)$/m.exec(t)?.[1] || '').trim(),
    complexity: {
      c: Number(/avg_complexity:\s*(\d)/.exec(t)?.[1] || 0),
      u: Number(/avg_uncertainty:\s*(\d)/.exec(t)?.[1] || 0),
      t: Number(/testing_scope:\s*(\d)/.exec(t)?.[1] || 0),
    },
  });
}

bolts.sort((a, b) => a.n - b.n);

const UNIT_LABEL = {
  '008-operator-identity': 'Operator Identity',
  '004-scale-integration': 'Scale Integration',
  '005-orgatex-integration': 'OrgaTEX Integration',
  '001-batch-management': 'Batch Management',
  '002-recipe-material-management': 'Recipe & Material',
  '003-weighing-station': 'Weighing Station',
  '006-ticket-printing': 'Ticket & Audit',
  '007-weighingms-ui': 'WeighingMS UI',
};

const UNIT_COLOR = {
  '008-operator-identity': '#7c5cd6',
  '004-scale-integration': '#5b8cc4',
  '005-orgatex-integration': '#4a9d8f',
  '001-batch-management': '#c9853f',
  '002-recipe-material-management': '#b8703f',
  '003-weighing-station': '#e8503a',
  '006-ticket-printing': '#2fbf6b',
  '007-weighingms-ui': '#f0a726',
};

const UNIT_ORDER = [
  '008-operator-identity',
  '004-scale-integration',
  '005-orgatex-integration',
  '001-batch-management',
  '002-recipe-material-management',
  '003-weighing-station',
  '006-ticket-printing',
  '007-weighingms-ui',
];

const unitOf = (id) => bolts.find((b) => b.id === id)?.unit;

// ── Layout ────────────────────────────────────────────────────────────────
// The map is laid out as two BANDS of four unit-columns each, stacked
// vertically. Eight columns in one row would exceed the width at which the
// evidence image can still be reviewed, and the two bands read in
// execution order anyway — the leaf seams in band one, the core and the
// outputs in band two.
const COL_W = 232;
const ROW_GAP = 18;
const PAD_X = 32;
const PAD_Y = 118;
const HEADER_H = 66;
const GAP_X = 26;
const BAND_GAP = 44;

const colIndex = new Map(UNIT_ORDER.map((u, i) => [u, i]));
const rowOf = new Map();
for (const u of UNIT_ORDER) {
  const mine = bolts.filter((b) => b.unit === u);
  mine.forEach((b, i) => rowOf.set(b.id, i));
}

const boxW = 202;
// The card grows with its story list, so a bolt's chips always sit inside it.
const boxHOf = (b) => 30 + b.stories.length * 12;

// Which band a unit's column sits in, and how tall that band needs to be.
// A band's height is the sum of its tallest column's cards plus the gaps.
const BAND_OF_UNIT = new Map();
UNIT_ORDER.forEach((u, i) => {
  BAND_OF_UNIT.set(u, Math.floor(i / 4));
});

function bandHeight(band) {
  const units = UNIT_ORDER.filter((u) => BAND_OF_UNIT.get(u) === band);
  let max = 0;
  for (const u of units) {
    const mine = bolts.filter((b) => b.unit === u);
    const h = mine.reduce((sum, b) => sum + boxHOf(b), 0) + Math.max(0, mine.length - 1) * ROW_GAP;
    max = Math.max(max, h);
  }
  return max;
}

const BAND_H = [bandHeight(0), bandHeight(1)];
const BAND_TOP = [PAD_Y, PAD_Y + HEADER_H + BAND_H[0] + BAND_GAP];

function pos(id) {
  const b = bolts.find((x) => x.id === id);
  const c = colIndex.get(b.unit);
  const band = BAND_OF_UNIT.get(b.unit);

  // Stack this unit's own cards, so each column's cards are contiguous.
  const mine = bolts.filter((x) => x.unit === b.unit);
  let y = BAND_TOP[band] + HEADER_H;
  for (const m of mine) {
    if (m.id === id) break;
    y += boxHOf(m) + ROW_GAP;
  }

  return { x: PAD_X + (c % 4) * (COL_W + GAP_X), y, w: boxW, h: boxHOf(b) };
}

const width = PAD_X * 2 + 4 * COL_W + 3 * GAP_X;
const height = BAND_TOP[1] + HEADER_H + BAND_H[1] + 84;

// ── Edges ─────────────────────────────────────────────────────────────────
function edgePath(fromId, toId) {
  const a = pos(fromId);
  const b = pos(toId);
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;

  const fromBand = BAND_OF_UNIT.get(unitOf(fromId));
  const toBand = BAND_OF_UNIT.get(unitOf(toId));

  // A cross-band dependency: route down the left margin, across under the
  // first band, and up into the target — so it never crosses a box.
  if (fromBand !== toBand) {
    const lane = 16;
    const under = BAND_TOP[toBand] - 16;
    return `M${a.x},${y1} L${lane},${y1} L${lane},${under} L${x2},${under} L${x2},${y2}`;
  }

  // Same band: left-to-right when the target column is later, otherwise
  // route around the right edge so a back-edge never crosses a box.
  if (colIndex.get(unitOf(toId)) % 4 >= colIndex.get(unitOf(fromId)) % 4) {
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} L${mid},${y1} L${mid},${y2} L${x2},${y2}`;
  }
  const route = width - 16;
  return `M${a.x + a.w},${y1} L${route},${y1} L${route},${y2} L${b.x + b.w},${y2}`;
}

const edges = [];
for (const b of bolts) {
  for (const r of b.requires) edges.push({ from: r, to: b.id });
}

// ── HTML ──────────────────────────────────────────────────────────────────
function boltCard(b) {
  const p = pos(b.id);
  const color = UNIT_COLOR[b.unit];

  // Each story becomes its own <text> element. Concatenating them into one
  // string produced a single unreadable line, because SVG <text> has no
  // wrapping and no HTML spans.
  const storyLabels = b.stories.map((s) => s.replace(/^\d{3}-/, ''));
  const chips = storyLabels
    .map((label, i) => {
      const short = label.length > 26 ? label.slice(0, 24) + '…' : label;
      return `<text x="${p.x + 13}" y="${p.y + 36 + i * 12}" class="bchip">· ${short}</text>`;
    })
    .join('');

  const dots = ['c', 'u', 't']
    .map((k, i) => {
      const label = k === 'c' ? 'complexity' : k === 'u' ? 'uncertainty' : 'testing scope';
      return `<circle cx="${p.x + p.w - 34 + i * 12}" cy="${p.y + 14}" r="3.5" class="d${b.complexity[k]}"><title>${label}: ${b.complexity[k]}</title></circle>`;
    })
    .join('');

  // The bolt id is truncated so it cannot run under the complexity dots.
  const shortId = b.id.length > 24 ? b.id.slice(0, 23) + '…' : b.id;

  return `
  <g>
    <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8"
          fill="#1a2029" stroke="${color}" stroke-width="1.6"/>
    <rect x="${p.x}" y="${p.y}" width="4" height="${p.h}" rx="2" fill="${color}"/>
    <text x="${p.x + 13}" y="${p.y + 18}" class="bid">${shortId}</text>
    ${chips}
    ${dots}
  </g>`;
}

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; background:#12161c; font-family:'Segoe UI',system-ui,sans-serif; }
  .title { fill:#e9eef4; font-size:21px; font-weight:700; }
  .subtitle { fill:#8998a9; font-size:12.5px; }
  .colhdr { font-size:13px; font-weight:700; }
  .colhdrsub { fill:#63717f; font-size:10.5px; }
  .bid { fill:#e9eef4; font-size:11px; font-weight:600; font-family:Consolas,monospace; }
  .bchip { fill:#8998a9; font-size:8.5px; font-family:Consolas,monospace; }
  .d1 { fill:#2fbf6b; } .d2 { fill:#f0a726; } .d3 { fill:#e8503a; }
  .legend { fill:#8998a9; font-size:11px; }
  .legendhdr { fill:#e9eef4; font-size:12px; font-weight:700; }
</style></head>
<body>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <text x="${PAD_X}" y="42" class="title">WeighingMS — Bolt Plan</text>
  <text x="${PAD_X}" y="64" class="subtitle">28 bolts · 38 stories · 8 units — the global 3-digit sequence runs left to right, and the build order follows the arrows</text>

  ${UNIT_ORDER.map((u, i) => {
    const band = BAND_OF_UNIT.get(u);
    const x = PAD_X + (i % 4) * (COL_W + GAP_X);
    const y = BAND_TOP[band];
    const mine = bolts.filter((b) => b.unit === u);
    const color = UNIT_COLOR[u];
    const types = [...new Set(mine.map((b) => (b.type === 'simple-construction-bolt' ? 'simple' : 'ddd')))].join(' + ');
    return `
    <rect x="${x}" y="${y}" width="${COL_W}" height="52" rx="8" fill="#212936" stroke="${color}" stroke-width="1.2" opacity="0.55"/>
    <text x="${x + 14}" y="${y + 22}" class="colhdr" fill="${color}">${UNIT_LABEL[u]}</text>
    <text x="${x + 14}" y="${y + 39}" class="colhdrsub">${u} · ${mine.length} bolt${mine.length === 1 ? '' : 's'} · ${types}</text>`;
  }).join('')}

  <g stroke="#63717f" stroke-width="1.8" fill="none" marker-end="url(#arrow)" opacity="0.9">
    ${edges.map((e) => `<path d="${edgePath(e.from, e.to)}"/>`).join('\n    ')}
  </g>

  ${bolts.map(boltCard).join('')}

  <g transform="translate(${PAD_X},${height - 56})">
    <text x="0" y="0" class="legendhdr">Legend</text>
    <text x="62" y="0" class="legend">Dots per bolt: complexity · uncertainty · testing scope (1 low → 3 high)</text>
    <text x="62" y="17" class="legend">A bolt's colour is its unit's; a dashed-free arrow means "must complete first"</text>
  </g>

  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a5a6b"/>
    </marker>
  </defs>
</svg>
</body></html>`;

// ── Render ────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  const tmp = path.join(OUT, '.tmp-step12-bolt-map.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await page.goto('file:///' + tmp.replace(/\\/g, '/'));
  await page.waitForTimeout(400);

  const body = await page.$('body');
  await body.screenshot({ path: path.join(OUT, 'STEP-12-bolt-map.png') });
  await ctx.close();
  fs.unlinkSync(tmp);

  console.log(`wrote evidence/STEP-12-bolt-map.png (${width}x${height})`);
  await browser.close();
})();
