---
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: complete
created: 2026-10-29T13:45:00Z
updated: 2026-10-29T13:45:00Z
source: docs/customize-weighing-station.html
---

# UI/UX Analysis: WeighingMS Operator Terminal Prototype

> **Analysis of a functional prototype. The prototype is not redesigned.**
> Every finding below is traceable to a specific element, attribute or function
> in `docs/customize-weighing-station.html`. Where the prototype cannot answer a
> question, that is recorded in §12 rather than filled with an assumption.

---

## 1. Screen Inventory

The prototype renders **one physical device** containing **three mutually exclusive views**.
Only one view carries `.active` at a time; `showView(name)` toggles `.active` across
`["queue", "weigh", "done"]` and syncs the segmented control's `aria-pressed`.

| # | View | DOM id | Purpose | Entry condition |
|---|---|---|---|---|
| 1 | **Select batch** | `v-queue` | Choose a released batch to work on | Initial view; also reachable via "Next batch" |
| 2 | **Weigh** | `v-weigh` | Guided dispensing of the current component | Batch selected and recipe loaded |
| 3 | **Confirm & print** | `v-done` | Batch completion summary and ticket | Last component confirmed |

**Persistent chrome** (present in all three views):

| Element | DOM | Purpose |
|---|---|---|
| Top bar | `.topbar` | Brand + station, batch/order/machine crumb, operator chip |
| Status strip | `.strip` | Peripheral state — both scales, scanner, printer, OrgaTEX link, clock |
| Screen switcher | `.seg` | **Prototype chrome only** — a demo control, not a product feature |

### Screen 1 — Select batch

| Element | DOM | Content |
|---|---|---|
| Scan prompt | `.scan-prompt` | "Scan a batch card to begin", "Or touch a row below", "Queue received from OrgaTEX at 06:12" |
| Scan beam | `.beam` | Decorative animated indicator, `aria-hidden="true"` |
| Batch table | `table.q` | Columns: Batch, Order, Machine, Fabric/lot, Shade, Comp., Status |
| Row | `tr` | `tr.sel` marks the currently selected batch |
| Status tag | `.tag` | `QUEUED`, `WEIGHING` (`.tag.now`) |

Seed data: B-24187 (WEIGHING, 5 components), B-24188, B-24190, B-24191.

### Screen 2 — Weigh

| Region | DOM | Content |
|---|---|---|
| Recipe rail | `aside.rail` | Recipe name, batch, "N of M components weighed", component list |
| Rail item | `li > button.comp` | `data-state` = `done` / `active` / `pending` |
| Rail item content | — | Swatch, name, code + scale class, target qty + unit, state text |
| Component header | `.weigh-head` | Dyestuff name, code, lot, container, tare; selected scale badge |
| Readout | `.readout` | Three cells: Weighed now / Still to weigh / Target |
| Progress bar | `.bar` | `role="progressbar"`, fill, tolerance band, target line |
| Bar caption | `.bar-caption` | "0", tolerance range caption, scale capacity |
| Status line | `.status-line` | Zone-dependent instruction |
| Surplus panel | `.surplus` | Hidden unless over tolerance; compensation proposal |
| Actions | `.actions` | OK·Confirm (F1), Re-tare (F2), Quit (F4), Supervisor override |

### Screen 3 — Confirm & print

| Element | DOM | Content |
|---|---|---|
| Heading | `.done-msg .h` | "Batch B-24187 weighed" |
| Summary rows | `.summary .r` | Components weighed, All within tolerance, Total dispensed, Elapsed, Operator, Written to OrgaTEX |
| Note | `.done-msg p` | "Actual consumption posted against the batch. Container released for transport to JET-04." |
| Actions | `.actions` | Print ticket (F1), Next batch (F3) |
| Ticket | `.ticket` | Header, field list, component table, outcome, barcode, batch ID |
| Disclaimer | — | "Label content is invented." |

---

## 2. UI Components

### Component inventory

| Component | DOM | Class/selector | State dimension |
|---|---|---|---|
| Brand mark | `.brandmark` | `.n` (WeighingMS), `.s` (STATION 01) | — |
| Batch crumb | `.crumb` | Batch / Order / Machine | — |
| Operator chip | `.op-chip` | `.dot` (green = signed in) | signed-in / not |
| Scan prompt | `.scan-prompt` | `.big`, `.sm` | — |
| Batch table | `table.q` | `.mono` for identifiers, numeric columns | row selected / not |
| Status tag | `.tag` | `.now` for in-progress | QUEUED / WEIGHING |
| Recipe rail | `aside.rail` | `.rail-head` with `.t`, `.v`, `.m` | — |
| Rail item | `.comp` | `data-state` | `done` / `active` / `pending` |
| Swatch | `.swatch` | inline `background` from `c.color` | dyestuff colour |
| Scale badge | `.scale-badge` | `.k`, `.v`, `.auto` | selected scale |
| Readout cell | `.cell` | `.live` for the current-weight cell | `data-zone` |
| Progress bar | `.bar` | `.fill`, `.band`, `.target-line` | `data-zone` |
| Band caption | `.bar-caption` | centre span is the tolerance range | — |
| Status line | `.status-line` | `data-zone` | `under`/`near`/`ok`/`over` |
| Surplus panel | `.surplus` | `.on` when visible | visible / hidden |
| Action key | `.key` | `.ok`, `.ghost`, `.fn` (function key) | enabled / disabled |
| Summary row | `.summary .r` | `.k`, `.v`, `.good` | — |
| Ticket | `.ticket` | `.c` (centred), `.bold`, `.mono` | — |
| Barcode | `.barcode` | Generated from a seeded PRNG | — |
| Status strip | `.strip` | `.stat`, `.dot.up`, `.dot.warnd` | up / warned |
| Question pin | `.pin` | orange badge with tooltip | shown / hidden |

### Design tokens

Extracted verbatim from the `:root` block.

**Device panel — constant across viewer themes** (it depicts a physical HMI):

| Token | Value | Use |
|---|---|---|
| `--hmi-bezel` | `#0a0d11` | Device bezel |
| `--hmi-bg` | `#12161c` | Screen background |
| `--hmi-panel` | `#1a2029` | Panel surfaces |
| `--hmi-panel-2` | `#212936` | Raised surfaces |
| `--hmi-line` | `#2c3644` | Dividers, borders |
| `--hmi-ink` | `#e9eef4` | Primary text |
| `--hmi-muted` | `#8998a9` | Secondary text |
| `--hmi-dim` | `#63717f` | Tertiary text, function-key labels |
| `--ok` | `#2fbf6b` | In-tolerance |
| `--warn` | `#f0a726` | Near target / warning |
| `--over` | `#e8503a` | Over tolerance |
| `--steel` | `#5b8cc4` | Scale / neutral-blue accent |
| `--mono` | `ui-monospace, "SF Mono", …` | Identifiers, quantities on the ticket |
| `--sans` | `ui-sans-serif, system-ui, …` | Interface text |

**Page chrome** (surrounding the device — prototype presentation only, not product): `--page-bg`,
`--page-panel`, `--page-ink`, `--page-muted`, `--page-line`, `--page-accent`, `--pin`. The prototype
comments this explicitly: *"Page chrome follows the viewer's theme. The device screen does not:
it depicts a physical HMI panel, so it stays dark in both themes."*

**Implication for the build:** the operator UI is **always dark**. It is a fixed-theme physical panel,
not a responsive web page. The product must not inherit the viewer's colour scheme.

---

## 3. User Actions

| Action | Trigger | DOM | Effect |
|---|---|---|---|
| Switch screen | Click | `.seg button` | `showView()` — prototype chrome only |
| Simulate dispense | Click | `#sim-ok` | `run(target + tol × 0.4)` — **demo control**, replaced by the real scale stream |
| Simulate overshoot | Click | `#sim-over` | `run(target + tol × 4.8)` — **demo control**, must be reproduced by the Dummy Scale |
| Reset | Click | `#sim-reset` | `reset()` — zeroes the weight |
| Toggle question pins | Click | `#pin-toggle` | Shows/hides the orange pins — **prototype chrome only** |
| Select batch | Scan or click | queue row / scanner | Loads the recipe, moves to `v-weigh` |
| Select component | Click | `.comp` | `select(i)` — only if not `done`; resets the dispense |
| Confirm | Click / F1 | `#btn-ok` | Records actual, marks `done`, advances to next pending component |
| Re-tare | Click / F2 | `#btn-retare` | `reset()` — zeroes weight, re-establishes tare |
| Quit | Click / F4 | `#btn-quit` | `reset()` — abandons the current component |
| Supervisor override | Click | `#btn-override` | Sets status to "OVERRIDE REQUESTED — AWAITING SUPERVISOR" |
| Print ticket | Click / F1 | `.done` action | Prints the ticket |
| Next batch | Click / F3 | `.done` action | Returns to the queue |

**Function-key mapping** (`.fn` labels, 21-key terminal per BRD IR-17): F1 = Confirm / Print,
F2 = Re-tare, F3 = Next batch, F4 = Quit. The **Supervisor override key has no function-key label**.

---

## 4. Application States

### 4.1 Component states

```
        select(i)                 confirm
pending ────────► active ──────────────────► done
   ▲                 │  ▲                        │
   └─────────────────┘  └──── reset() ──────────┘
        abandon / re-select          (done is terminal)
```

| State | Set by | Rail label | Behaviour |
|---|---|---|---|
| `pending` | Initial, or when another component is selected | "PENDING" | Selectable; no weighing |
| `active` | `select(i)`, or `btn-ok` advancing to the next pending | "WEIGHING" | The component being dispensed |
| `done` | `btn-ok` | "✓ 1241.5" | Terminal. `select()` refuses it. Shows the actual |

`select(i)` enforces two rules in one line:
```js
if (components[i].state === "done") { return; }              // done is terminal
components.forEach(...)                                        // only one active at a time
```

### 4.2 Weight zone states

`zone(v)` — the central state function of the whole product:

```js
function zone(v) {
  var k = c();
  if (v > k.target + k.tol) { return "over"; }
  if (v >= k.target - k.tol) { return "ok"; }
  if (v >= k.target * 0.9)   { return "near"; }
  return "under";
}
```

| Zone | Condition | Readout colour | Fill colour | Status line |
|---|---|---|---|---|
| `under` | `v < target × 0.9` | `--hmi-ink` | default | `DISPENSE — {n} REMAINING` |
| `near` | `target × 0.9 ≤ v < target − tol` | `--warn` | `--warn` | `DISPENSE — {n} REMAINING` |
| `ok` | `target − tol ≤ v ≤ target + tol` | `--ok` | `--ok` | `WITHIN TOLERANCE — PRESS OK TO CONFIRM` |
| `over` | `v > target + tol` | `--over` | `--over` | `OVER TOLERANCE — SURPLUS +{n}` |

**Boundary precision (this matters):**
- The `ok` band is **inclusive at both ends** (`>=` lower, `<=` upper via the `over` test).
- `near` starts at **90% of target** — a *relative* threshold, independent of tolerance.
- The `near`/`under` distinction is purely presentational. It has **no effect on whether
  confirmation is enabled** — only `zone === "ok"` does that.

### 4.3 View state

Exactly one of `v-queue` / `v-weigh` / `v-done` carries `.active`. `btn-ok` moves to `v-done`
only when no `pending` component remains.

---

## 5. Data Displayed

| View | Field | Source in prototype | Prototype origin |
|---|---|---|---|
| Queue | Batch, Order, Machine, Fabric/lot, Shade, Components, Status | `table.q` rows | Hard-coded markup |
| Queue | "Queue received from OrgaTEX at 06:12" | `.scan-prompt .sm` | Hard-coded text |
| Weigh | Recipe name, batch, "N of M components weighed" | `.rail-head` | Hard-coded / `rail-done` |
| Weigh | Swatch, name, code, scale class, target, state | `.comp` | `renderComps()` from `components[]` |
| Weigh | Dyestuff name | `w-name` | `c().name` |
| Weigh | Code, lot, container, tare | `w-meta` | `c().code`, `c().lot`, `c().cont`, `c().tare` |
| Weigh | Selected scale | `w-scale` | `c().scale` |
| Weigh | Weighed now / Still to weigh / Target | `w-now`, `w-left`, `w-target` | `now`, `max(0, target−now)`, `c().target` |
| Weigh | Progress %, band, target line | `fill`, `band`, `tline` | Derived from `now`, `c().max`, `c().tol` |
| Weigh | Tolerance caption | `cap-band` | `target ± tol` |
| Weigh | Scale capacity | `cap-max` | `c().max` |
| Weigh | Surplus panel | `surplus` | `now − target`, and proposed revised targets |
| Done | Summary rows | `.summary` | Hard-coded (5 of 5, YES, 35.322 kg, 6 min 41 s, R. Karim, CONFIRMED 07:48:22) |
| Done | Ticket | `.ticket` | Hard-coded |
| Strip | Scale/scanner/printer/OrgaTEX states, clock | `.strip` | Hard-coded, except the clock ticks |

### The component data model

```js
{ id, name, code, color, target, unit, tol, scale, max, state, actual, lot, cont, tare }
```

| Field | Meaning | Example | BRD equivalent |
|---|---|---|---|
| `id` | Recipe component id | `DYE-4471-B` | `component_id` |
| `name` | Dyestuff name | "Remazol Brill. Blue RSPL" | `DYESTUFF.name` |
| `code` | FCI article code | `DYE-1180` | `DYESTUFF.code` |
| `color` | Operator identification aid | `#1f4fa8` | `DYESTUFF.colour_hex` |
| `target` | Target quantity | `1240.0` | `target_qty` |
| `unit` | Unit of measure | `g` / `kg` | `uom` |
| `tol` | Tolerance magnitude (±) | `6.0` | `TOLERANCE_RULE.value` |
| `scale` | Selected scale | "3 kg precision" | `SCALE.class` + capacity |
| `max` | Scale capacity — the bar's full-scale | `1600` | `SCALE.capacity` |
| `state` | pending / active / done | `done` | (session state) |
| `actual` | Confirmed quantity | `1241.5` | `actual_qty` |
| `lot` | Supplier lot | `2026-0341` | `DYESTUFF_LOT.lot_id` |
| `cont` | Container id | `C-09` | `CONTAINER.container_id` |
| `tare` | Empty-container weight | `214` | `CONTAINER.tare_qty` |

### Quantity precision

```js
function dp(unit) { return unit === "kg" ? 3 : 1; }
function fmt(v, unit) { return v.toFixed(dp(unit)); }
```

**Grams display 1 decimal place, kilograms 3.** This matches the seed data, where gram
targets are `1240.0`/`386.0`/`94.0` and kilogram targets are `24.000`/`9.600`. Note this
differs from the BRD's `decimal(12,4)` storage precision — display precision and storage
precision are separate concerns, and the display rule is a prototype decision.

### Unit mixing

The recipe contains **both grams and kilograms** (`1240.0 g` … `9.600 kg`). The prototype's
"Total dispensed 35.322 kg" demonstrates the required conversion: summing the five actuals
(1241.5 g + 385.4 g + 94.2 g + 23.980 kg + 9.621 kg) = 35.322 kg.

---

## 6. Data Required

### Master data

| Entity | Fields needed | Source |
|---|---|---|
| **Batch** | id, order_ref, machine_ref, fabric_desc, fabric_weight_kg, shade_code, status, released_at | OrgaTEX |
| **Recipe** | id, shade_code, version, component_count | OrgaTEX (read-only) |
| **Recipe component** | id, sequence, dyestuff_id, target_qty, uom, tolerance_rule_id, is_compensable | OrgaTEX (read-only) |
| **Dyestuff** | id, code, name, type, default_uom, colour_hex, barcode | OrgaTEX |
| **Dyestuff lot** | lot_id, dyestuff_id, supplier, received_at | OrgaTEX if available, else WeighingMS |
| **Tolerance rule** | rule_id, mode, value, min_abs, max_abs | OrgaTEX |
| **Scale** | id, class, capacity, resolution, protocol, calibration dates | WeighingMS |
| **Container** | id, type, tare_qty, tare_source, in_service | WeighingMS |
| **Station** | id, name, location, status, printer_id, scanner_id, language | WeighingMS |
| **Operator** | id, name, badge_id, role, active | WeighingMS (or FCI directory — A-09) |

### Session data

| Entity | Fields |
|---|---|
| **Weighing session** | session_id, batch_id, station_id, operator_id, started_at, completed_at, status, sync_status |
| **Weighing record** | record_id, session_id, component_id, lot_id, container_id, scale_id, target_qty, actual_qty, uom, tolerance_min, tolerance_max, result, surplus_qty, operator_id, confirmed_at |

### Live data

| Stream | Fields | Rate |
|---|---|---|
| Scale weight | weight, stable flag, timestamp | ≥10 Hz (IR-10) |
| Scale status | connected, calibration due, tare state | On change / poll |
| Peripheral status | scanner, printer, OrgaTEX link | Continuous (IR-18) |
| Sync queue depth | unsynchronised record count | On change (FR-32) |

---

## 7. State Transitions

### Batch lifecycle

```
QUEUE VIEW ──scan/touch──► RECIPE LOADED ──► WEIGH VIEW
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                      component active      component done     all done
                              │                    │                    │
                              │                    ▼                    ▼
                              │              next component         v-done
                              │                    │              (summary +
                              └── reset/abandon ────┘               ticket)
                                                                        │
                                                     Print ticket ◄────┤
                                                                        ▼
                                                               ORGATEX POST
```

### Weighing lifecycle for one component

```
selected ──► tare established ──► stream connected ──► dispensing
                                                        │
                        ┌───────────────────────────────┼──────────────┐
                        ▼                               ▼              ▼
                     under/near                      ok (enable OK)    over
                        │                               │              │
                    continue                          confirm          surplus
                                                        │              │
                                                   done ──────┐   compensable?
                                                              │      │        │
                                                         next   compensate  escalate
                                                        comp    remaining   to override
                                                                  
```

### Transition rules extracted from the code

| # | Rule | Source |
|---|---|---|
| T-1 | A `done` component cannot be selected | `select()` guard |
| T-2 | Selecting a component resets the dispense to zero | `select()` → `reset()` |
| T-3 | Only one component is `active` at a time | `select()` forEach |
| T-4 | Confirm is enabled only in zone `ok` | `btn-ok.disabled = (z !== "ok")` |
| T-5 | Confirm advances to the **first `pending`** component in array order | `findIndex(x => x.state === "pending")` |
| T-6 | Confirm advances to `v-done` when no `pending` component remains | `if (next === -1) showView("done")` |
| T-7 | `done` becomes terminal — confirmed actuals are never revised in place | No code path sets `state` back from `done` |
| T-8 | The ticket is rendered only on the `v-done` view | Markup scope |
| T-9 | The surplus panel appears only in zone `over` | `classList.toggle("on", z === "over")` |
| T-10 | Override does not change the zone; it only changes the status text | `btn-override` handler sets `status.textContent` |

**T-5 is worth stating explicitly**: progression follows *array order*, and the array is the
recipe sequence. So progression is by recipe order, not by operator preference — matching BRD FR-06.

**T-10 is a prototype simplification.** The real override (FR-13) must authenticate a supervisor,
record a reason, and *then* enable confirmation — the prototype only changes a string.

---

## 8. Validation Behaviour

| Rule | Enforcement point | Message shown |
|---|---|---|
| Batch must be released | Selection | Reason displayed (FR-03) |
| Dyestuff identity must match | Component preparation | Rejected (FR-09, BR-10) |
| Scale must be in calibration | Component preparation | Blocked (FR-12, AC-14) |
| Weight must be in tolerance | `#btn-ok` disabled | Status line already says which zone |
| Supervisor auth required for override | Override action | Awaiting-supervisor status |
| Supervisor auth for manual reselection | Scale reselection | — |
| Supervisor auth for calibration bypass | Calibration bypass | — |
| Lot must be captured | Confirmation | — |
| Container must be assigned | Confirmation | — |

**The prototype's validation is deliberately shallow.** It disables the confirm button and
never validates identity, lot, container, calibration or authorisation. Those are the
prototype's gaps, and the requirements (FR-4, FR-5, FR-6, FR-7, FR-13, FR-21) supply the
rules the build must implement.

---

## 9. Integration Points

| Integration | Direction | Prototype representation | Required implementation |
|---|---|---|---|
| **OrgaTEX** — batch queue | Inbound | Hard-coded `<tr>` rows | `GET /api/batches` (Dummy OrgaTEX) |
| **OrgaTEX** — recipe | Inbound | Hard-coded `components[]` | `GET /api/batches/:id/recipe` |
| **OrgaTEX** — consumption | Outbound | Hard-coded "CONFIRMED 07:48:22" | `POST /api/batches/:id/consumption` |
| **OrgaTEX** — batch status | Outbound | Hard-coded `WEIGHING` tag | `PATCH /api/batches/:id/status` |
| **Scale** — weight | Inbound | `setInterval(…, 34)` synthetic ramp | `GET /api/scales/:id/weight` (SSE, ≥10 Hz) |
| **Scale** — stability | Inbound | Not modelled | `stable` flag in the stream |
| **Scale** — tare | Outbound | `reset()` zeroes the local value | `POST /api/scales/:id/tare` |
| **Scale** — calibration | Inbound | Not modelled | `GET /api/scales/:id/status` |
| **Scanner** — barcode | Inbound | Not modelled | `POST /api/scan` |
| **Printer** — ticket | Outbound | Static `.ticket` markup | `POST /api/tickets` |

**Every data point in the prototype is currently hard-coded.** The build must replace every
one of them with a call to the corresponding Dummy API. This is Workbook Rule 5.

### The synthetic dispensing ramp

```js
var step = Math.max(k.target * 0.004, remaining * 0.055);
now = Math.min(landing, now + step);
```

Two regimes: a floor of **0.4% of target per tick** for fine settling, and **5.5% of the
remaining** for the initial pour — "fast at first, easing off as the target approaches —
how a person actually pours". The tick interval is **34 ms** (~29 Hz), faster than the
10 Hz the BRD requires.

**The Dummy Scale must reproduce this behaviour**, because it is what makes the guided
interaction demonstrable: the operator sees weight climb fast, then settle. The two
simulation landings are `target + tol × 0.4` (a good dispense) and `target + tol × 4.8`
(an overshoot).

---

## 10. Business Rules Embedded in JavaScript

| # | Rule | Implementation | BRD |
|---|---|---|---|
| BR-1 | Tolerance zone boundaries | `zone(v)` | FR-9 |
| BR-2 | The `ok` band is inclusive at both ends | `>=` lower; `over` is `>` | FR-9, AC-04 |
| BR-3 | `near` begins at 90% of target | `v >= k.target * 0.9` | FR-9 |
| BR-4 | Confirmation requires zone `ok` | `btn-ok.disabled = (z !== "ok")` | FR-10, AC-04 |
| BR-5 | Only one component is active at a time | `select()` forEach | FR-14 |
| BR-6 | A confirmed component is terminal | `select()` done-guard | FR-10, DR-02 |
| BR-7 | Progression follows recipe order | `findIndex(state === "pending")` | FR-14 |
| BR-8 | Still-to-weigh is clamped at zero | `Math.max(0, target - now)` | FR-8 |
| BR-9 | The bar's full scale is the scale capacity, not the target | `(now / k.max) * 100` | FR-8 |
| BR-10 | The tolerance band is positioned in capacity coordinates | `((target ± tol) / max) * 100` | FR-8, FR-15 |
| BR-11 | The band has a minimum visible width | `Math.max(0.6, hi - lo)` | FR-15 |
| BR-12 | Surplus is measured above the target | `now - k.target` | FR-11 |
| BR-13 | Surplus is shown as absolute and percentage | "+2.4 g (+2.6%)" | FR-11 |
| BR-14 | Compensation preserves the shade ratio by proportional recalculation | Surplus table: 24.000→24.624 kg, 9.600→9.850 kg | FR-12 |
| BR-15 | Grams show 1 dp, kilograms 3 dp | `dp(unit)` | FR-8 |
| BR-16 | Total dispensed sums across units | 35.322 kg | FR-15 |
| BR-17 | A dispense is abandoned by resetting to zero | `reset()` | FR-10 |
| BR-18 | Reduced-motion is honoured | `prefers-reduced-motion` → jump straight to the landing | NFR-4 |
| BR-19 | The clock runs independently | `setInterval(…, 1000)` | — |
| BR-20 | The barcode is a deterministic pseudo-random bar pattern | seeded LCG, `seed = 7` | FR-17 |

**BR-14 deserves a note.** The prototype's compensation table proposes:
Sodium Sulphate 24.000 → 24.624 kg, Soda Ash 9.600 → 9.850 kg.
The factor is 24.624 / 24.000 = **1.026** — and the surplus was +2.4 g on a 94.0 g target
(2.55%). So the remaining components are scaled by the *over-dose ratio*. This is the
concrete working of A-08, and it is the single most likely point of misunderstanding
(BRD R-03). The exact rule must be treated as **assumed**, not confirmed.

---

## 11. Assumptions Represented by the Prototype

| # | Assumption | Evidence in prototype | Risk |
|---|---|---|---|
| P-1 | The scale streams continuously | Live readout, progress bar | Severe (A-05) |
| P-2 | Tolerance is expressed as a symmetric ± absolute quantity | `tol`, `target ± tol` | Moderate (A-07) |
| P-3 | Scale selection is automatic | `.scale-badge .auto` = "automatic" | Moderate (A-06) |
| P-4 | Surplus compensation = proportional recalculation | Surplus table | **High (A-08)** |
| P-5 | One container per component | `cont` is a single field per component | Moderate (Q-10) |
| P-6 | The lot is known per component | `lot` present, no capture UI | Moderate (Q-10) |
| P-7 | Operators log in individually | `op-chip` — "Operator R. Karim · Shift A" | Moderate (A-09, Q-08) |
| P-8 | English interface | All labels in English | Moderate (A-10) |
| P-9 | Two scales: 3 kg precision, 32 kg floor | `scale` values | Confirmed by BRD §16 |
| P-10 | The label content is invented | "Label content is invented." | Low (A-04, Q-11) |
| P-11 | One operator works one station at a time | Single `op-chip` | Low (A-11) |
| P-12 | The 21-key terminal duplicates touchscreen actions | `.fn` labels F1–F4 | Moderate (A-10) |
| P-13 | A component can be re-selected out of sequence | `select()` allows pending→active | Low |
| P-14 | Re-tare is an operator action, not automatic | `#btn-retare` is a button | Low |

---

## 12. Questions the Prototype Cannot Answer

| # | Question | Why the prototype cannot answer it | BRD ref |
|---|---|---|---|
| Q-01 | What exactly does the OrgaTEX interface expose? | The prototype hard-codes every value; no contract is implied | A-01, Q-01 |
| Q-02 | Is consumption posting idempotent, and how is it keyed? | The prototype only shows a hard-coded "CONFIRMED" | IR-08 |
| Q-03 | What are the real scale models and protocols? | The scale is a `setInterval`, not a device | A-05, Q-03 |
| Q-04 | What is the scale-selection threshold? | The prototype shows the *result* ("3 kg precision"), never the rule | A-06, Q-04 |
| Q-05 | Is tolerance a percentage, an absolute, banded, or per-dyestuff? | `tol` is a flat absolute; the derivation is not shown | A-07, Q-05 |
| Q-06 | Is the compensation factor exactly the over-dose ratio? | The table shows two numbers consistent with 1.026, but no formula | A-08, Q-06 |
| Q-07 | What happens when the over-dose is *not* compensable? | The prototype has no non-compensable branch | FR-13, Q-06 |
| Q-08 | How is the barcode actually captured? | No scanner UI exists | A-10, Q-07 |
| Q-09 | How are lots captured? | `lot` is present but has no capture path | Q-10 |
| Q-10 | How are containers identified and assigned? | `cont` is a static field | Q-10 |
| Q-11 | What is the real ticket content, printer language and barcode symbology? | "Label content is invented." | A-04, Q-11 |
| Q-12 | How does operator authentication work? | `op-chip` shows a name; there is no login | A-09, Q-08 |
| Q-13 | What does supervisor override require, and how is it logged? | The handler only sets a status string | FR-13, FR-21 |
| Q-14 | How is calibration expiry enforced? | No calibration state exists | FR-7, FR-12 |
| Q-15 | What is the offline/sync behaviour? | No connectivity state exists | A-03 |
| Q-16 | What is the ticket reprint marking? | No reprint path exists | FR-28 |
| Q-17 | How are units converted for the total? | 35.322 kg is hard-coded; the conversion is not shown | FR-15 |
| Q-18 | What are the baseline metrics for the business case? | Not a UI question | A-14, Q-12 |

---

## 13. Build Implications

### Must reproduce exactly

1. **Three views**, mutually exclusive, with the same transition rules (T-1…T-10).
2. **The four tolerance zones** with the exact boundaries (BR-1, BR-2, BR-3).
3. **The dark HMI theme** with the same token values — the operator screen does not follow the viewer's theme.
4. **The recipe rail** with swatch, name, code, scale class, target and state.
5. **The progress bar scaled to scale capacity**, with the band and target line, minimum band width 0.6%.
6. **Grams at 1 dp, kilograms at 3 dp.**
7. **The surplus panel** with absolute + percentage surplus and the before/after table.
8. **The status strip** covering both scales, scanner, printer and the OrgaTEX link.
9. **Function-key labels** F1–F4 on the action keys.
10. **`prefers-reduced-motion`** handling.

### Must be built, but is not in the prototype

Everything in §8 (validation), §9 (real integrations), plus: authorisation, calibration
enrolment, offline sync, reprint marking, operator authentication, audit trail, reporting,
and localisation. These come from the requirements, not the prototype.

### Must not be carried over from the prototype

| Element | Reason |
|---|---|
| `.seg` screen switcher | Prototype chrome — the product has no screen switcher |
| `#sim-ok`, `#sim-over`, `#sim-reset` | Demo controls — replaced by the Dummy Scale's real stream |
| `.pin` question badges | Prototype annotation aid for discussing open questions |
| `prefers-reduced-motion` jump-to-landing | Demo shortcut — the real stream is continuous |
| Hard-coded clock | Real clock, but the strip state comes from the APIs |

### Artefacts to carry into construction

| Artefact | From |
|---|---|
| Design token set | §2 |
| Component data model | §5 |
| Tolerance zone function | §4.2, BR-1…BR-3 |
| Transition rules | §7, T-1…T-10 |
| Embedded business rules | §10, BR-1…BR-20 |
| Synthetic dispensing ramp | §9 |
| Component inventory | §2 |
| Screen inventory | §1 |
