---
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: WeighingMS UI

## Purpose

The operator terminal.

This unit renders the three views of the supplied prototype — Select batch,
Weigh, Confirm & print — and reproduces the interaction rules that make them
usable by a dyehouse operator wearing gloves, standing at a machine, at
1.5 metres, in a hurry.

It is the **only** unit with a rendering concern, the only one tested for
ergonomics rather than correctness, and the only one whose failure is
*degraded but not incorrect*.

---

## Scope

### In Scope

- The **three views**: Select batch (`#v-queue`), Weigh (`#v-weigh`), Confirm
  & print (`#v-done`), and the transitions between them.
- The **persistent chrome**: the topbar crumb (batch · order · machine), the
  peripheral status strip, the clock.
- The **recipe rail** with each component's state (`PENDING` / `ACTIVE` /
  `DONE`), and its role as the component selector.
- The **live readout**, the **tolerance band bar**, and the **status line**
  — the three elements that turn a number into a judgement.
- The **surplus panel** and the **escalation panel**.
- The **action row** and **function-key handling** (F1–F4).
- The **degraded states** for every peripheral failure: a scale that is
  silent, a scanner that will not read, a printer that is out of paper, a
  link that is down.
- **Externalised text** for every operator-facing string (NFR-11).
- Touch targets ≥ 15 mm and legibility at 1.5 m (NFR-07, NFR-08).

### Out of Scope

- Every functional requirement. **This unit owns none** — see §Notes.
- The weighing rules, the tolerance engine, the confirmation gate →
  `003-weighing-station`.
- The weight stream's origin → `004-scale-integration`.
- Any hard-coded data. Nothing about a batch, a recipe or a weight may be
  defined in this unit.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| — | *(none — this unit consumes every FR through the API)* | — |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `AppView` | Which of the three views is showing | `id` (`queue` \| `weigh` \| `done`) |
| `SessionSnapshot` | The UI's view of the weighing session | `sessionId`, `state`, `batch`, `components[]`, `activeComponentId`, `zone`, `weight`, `surplus`?, `escalation`? |
| `RecipeRailItem` | One row of the recipe rail | `componentId`, `name`, `targetQuantity`, `unit`, `state`, `actualQuantity`?, `lotNumber`?, `containerId`? |
| `LiveReadout` | The weight shown to the operator | `value`, `unit`, `stable`, `receivedAt`, `ageMs` |
| `ToleranceBandBar` | The bar showing the tolerance band on the scale's capacity | `percent`, `bandStart`, `bandEnd`, `target`, `max`, `zone` |
| `PeripheralStatus` | The status strip's entries | `scale` (`LINKED` \| `DEGRADED` \| `OFFLINE`), `scanner`, `printer`, `orgatex`, `lastUpdatedAt` |
| `ActionRow` | The available operator actions | `actions[]`, each with `key`, `label`, `enabled`, `reason`? |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `renderQueue` | Show the batch queue | queue snapshot | Select-batch view |
| `renderWeigh` | Show the active component and live weight | session snapshot, live readout | Weigh view |
| `renderDone` | Show the batch completion summary and ticket | session snapshot, ticket | Confirm & print view |
| `renderStatusStrip` | Show real peripheral link states | peripheral status | status strip |
| `renderSurplus` | Show the compensation proposal | surplus proposal | surplus panel |
| `renderEscalation` | Show the supervisor authorisation prompt | escalation record | escalation panel |
| `handleKey` | Map a function key or touch to an action | key or target | action dispatch |
| `applyLocale` | Render in the selected language | locale bundle | re-rendered UI |

### Rendering the zone

The status line, the readout colour and the tolerance band all derive from
the **zone** that unit 003 computes. The UI never computes a zone — it
receives one. This is not a stylistic choice: if the UI computed zones, the
same reading would be classified in two places, and the confirmation gate
would depend on which one ran last.

| Zone | Colour token | Status line | Confirmation |
|---|---|---|---|
| `OVER` | `--over` | OVER TOLERANCE — SURPLUS +n | disabled |
| `OK` | `--ok` | WITHIN TOLERANCE — PRESS OK TO CONFIRM | enabled |
| `NEAR` | `--warn` | DISPENSE — n REMAINING | disabled |
| `UNDER` | `--hmi-ink` | DISPENSE — n REMAINING | disabled |

The **disabled** state of the confirm button is not decorative. It is the
visual half of FR-10, and its `reason` (why the action is unavailable) is
shown to the operator, because a silently dead button on a gloved terminal
is a support call.

### The tolerance band bar

The prototype computes the bar's scale against the **scale's maximum
capacity**, not against the target, and the tolerance band is
`(target ± tolerance) / max`. This is reproduced exactly, because it is
what the operator learned to read: the bar shows how full the scale is, and
the band is where "right" sits within that fullness.

### No data in the client

Rule 5 of the workbook and BRD IR-07 both forbid hard-coded fixture data
in the UI. The consequences are specific and testable:

- No batch, recipe, component, weight or lot is defined in the client.
- The `ORGATEX · LINKED` string is **not** hard-coded — it reads the real
  link state.
- Every operator-facing string comes from the locale bundle, so a language
  can be changed without a redeployment (NFR-11).
- The only thing hard-coded in the client is **the design token set** and
  the prototype's own interaction rules — which are the specification, not
  the data.

**Rule 2 (workbook): no invented requirements.** The prototype's
hard-coded component array is a **prototype convenience**, not a
requirement, and it is deliberately not carried over. What *is* carried over
is the interaction behaviour it demonstrates: the `done` component is
terminal, the first `pending` component is selected automatically, and the
decimal rule is 1 dp for grams and 3 dp for kilograms.

### Degraded states

Each peripheral failure has a **visible, specific** state, and none of them
shows a wrong number (B-1…B-11):

| Failure | What the operator sees |
|---|---|
| Scale silent | The readout shows *no value* — never `0.0` — and the confirm action is disabled with a reason. |
| Scale out of calibration | Weighing is blocked, with the reason stated. |
| Scanner unreadable | The scan panel reports the failure and offers attestation. It never silently skips. |
| Printer out of paper | The weighing is recorded; the ticket is shown as not printed, and can be reprinted. |
| OrgaTEX down | The link state reads `OFFLINE`; the queue shows its last known state with its age; writes are shown as pending. |

The governing rule is the system's: **no failure at any boundary may
produce a silently wrong number.**

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 5 |
| Must Have | 5 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Select a batch from the queue | Must | Planned |
| 002 | Watch the live weight and the tolerance zone while dispensing | Must | Planned |
| 003 | Confirm a weighing and advance to the next component | Must | Planned |
| 004 | Review and print the ticket at batch completion | Must | Planned |
| 005 | See peripheral failures as explicit degraded states | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| `003-weighing-station` | The session snapshot, the zone, the weight, the surplus proposal, the escalation. |
| `004-scale-integration` | The live weight stream and the scale status. |
| `005-orgatex-integration` | The link state. |
| `002-recipe-material-management` | The recipe rail with per-component state. |
| `001-batch-management` | The batch queue and the topbar crumb. |
| `006-ticket-printing` | The ticket preview and the print controls. |
| `008-operator-identity` | The signed-in operator and the supervisor prompt. |

### Depended By

| Unit | Reason |
|------|--------|
| — | None. This is the top of the stack. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| — | None directly. Everything reaches the UI through the API. | — |

---

## Technical Context

### Suggested Technology

TypeScript strict · **React 19 + Vite** · **Zustand** for the session
snapshot store · SSE subscription for the live weight · the prototype's
design tokens as CSS custom properties · Vitest + Testing Library for
component tests, Playwright for E2E · **no data in the client** — every
value arrives over the API.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `001-batch-management` | API (internal) | REST/JSON |
| `002-recipe-material-management` | API (internal) | REST/JSON |
| `003-weighing-station` | API (internal) | REST/JSON + **SSE (session state)** |
| `004-scale-integration` | API (internal) | **SSE (weight)** + REST (status) |
| `005-orgatex-integration` | API (internal) | REST/JSON |
| `006-ticket-printing` | API (internal) | REST/JSON |
| `008-operator-identity` | API (internal) | REST/JSON |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| UI state | In memory (Zustand) | Session-scoped | Not persisted — the API is the source of truth |
| Locale bundles | Fetched at runtime | One per language | — |

**The UI stores nothing.** No batch, no recipe, no weight and no
`localStorage` copy of a weighing. The session snapshot is re-fetchable
from the API, and a UI-side cache would create a second source of truth
for the same session.

---

## Constraints

- **No hard-coded data in the client** — no batches, no recipes, no
  components, no weights, no lots (workbook Rule 5, BRD IR-07).
- **No hard-coded link state.** `LINKED` / `DEGRADED` / `OFFLINE` are real
  values from the API.
- **All operator-facing text is externalised** (NFR-11) — no user-visible
  string is written in a component.
- **Touch targets ≥ 15 mm**; **legible at 1.5 m** (NFR-07, NFR-08).
- **Quantities are formatted, never parsed as float** — 1 dp for grams,
  3 dp for kilograms (BRD NFR-16).
- **A disabled action states its reason.**
- The displayed weight must lag the scale by **≤ 200 ms** (NFR-01), so
  the client renders the newest reading it has and shows its age when the
  stream falls behind.
- The zone is **received, never computed** by the client.

---

## Success Criteria

### Functional

- [ ] The queue view shows all seven columns from FR-1, with the time it
      was last received, and a filter by status.
- [ ] A batch is selectable by scan and by touch, and the selection is
      recorded with its method.
- [ ] The weigh view shows the recipe rail, the live weight, the tolerance
      band and the status line.
- [ ] The status line and readout colour match the zone the API reports.
- [ ] The confirm action is enabled only in the `OK` zone, and is disabled
      with a stated reason otherwise.
- [ ] Confirming advances to the first pending component in recipe order,
      and the rail reflects it.
- [ ] A done component cannot be selected.
- [ ] The surplus panel shows the proportional recalculation, and accepting
      it changes the remaining targets.
- [ ] The escalation panel asks for a supervisor authorisation with a
      reason.
- [ ] The completion view shows the batch summary and the ticket, and can
      print it.
- [ ] Each peripheral failure shows its own explicit degraded state, and no
      failure shows a wrong number.

### Non-Functional

- [ ] The displayed weight lags the scale by ≤ 200 ms (NFR-01, AC-03).
- [ ] Every touch target is ≥ 15 mm and the readout is legible at 1.5 m.
- [ ] The interface renders in a non-default language without a
      redeployment.
- [ ] No batch, recipe, component or weight is hard-coded in the client.
- [ ] The API and the UI run as separate processes with CORS, and the UI
      works when the API is unreachable (degraded, not broken).

### Quality

- [ ] A test asserts that the client source contains no user-visible
      literal strings.
- [ ] A test asserts that the client source contains no batch, recipe or
      weight fixture data.
- [ ] A test asserts the disabled confirm button carries a reason.
- [ ] Playwright E2E covers the full flow: select batch → dispense →
      confirm → advance → complete → print.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

> Generated from the bolt plan in `memory-bank/bolts/` by
> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**
> sequence across all units, not a per-unit one.

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `024-007-weighingms-ui` | Simple | 001-select-batch-from-queue | Build the app shell, the persistent chrome and the Select-batch view, with batch selection by scan and by t… |
| `025-007-weighingms-ui` | Simple | 002-watch-live-weight-and-tolerance-zone | Build the Weigh view — the recipe rail, the live readout, the tolerance band and the status line — driven e… |
| `026-007-weighingms-ui` | Simple | 003-confirm-weighing-and-advance | Build the action row, the confirmation, the progression, the surplus panel and the escalation prompt. |
| `027-007-weighingms-ui` | Simple | 004-review-and-print-ticket | Build the completion view, the ticket preview and the print controls, including the not-printed state a fai… |
| `028-007-weighingms-ui` | Simple | 005-show-peripheral-degraded-states | Build the degraded states, the status strip and the locale bundle wiring, so that every peripheral failure… |

---

## Notes

**This unit owns no functional requirement, and that is the point.** Every
FR in the decomposition belongs to a backend capability. The UI consumes
them through the session API and the peripheral APIs. If the Weighing
Station were a screen, this unit would carry FR-7 through FR-15 and units
001–006 would not exist. The split is what makes the claim in the workbook
— *"the Weighing Station is more than a screen"* — **demonstrable rather
than asserted**: the session API is provable without a UI, and the test
suite drives it directly.

**The UI does not compute zones.** It receives a zone and renders it. Two
classifications of the same reading in two places is the failure mode this
avoids, and it is also why the confirmation button's disabled state can be
trusted.

**The prototype was analysed, not redesigned.** Its design tokens, its
three views, its component lifecycle, its decimal rule, its bar scale and
its interaction rules are all reproduced. What was deliberately **not**
carried over: the hard-coded component array, the in-page ramp as a weight
source, the meeting-notes and pinned-question chrome, the hard-coded
`ORGATEX · LINKED` status, and the invented ticket content.

**The prototype's screen inventory is not the system's architecture.** Three
views is what a mockup needs to show a flow; it is not three deployable
things. The eight units behind them are capabilities, and this one is the
only one that draws.

**Testing this unit is a different discipline from the others.** Every
other unit is tested for correctness — boundary values, invariants, failure
modes. This one is tested for **ergonomics and honesty**: is the target big
enough for a glove, is the number legible at 1.5 m, and does the operator
see a *reason* when an action is unavailable? A UI that renders correctly
but cannot be used with a gloved hand has failed, and no unit test will
say so.
