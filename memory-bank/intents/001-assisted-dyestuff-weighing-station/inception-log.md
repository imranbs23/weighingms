---
intent: 001-assisted-dyestuff-weighing-station
created: 2026-10-29T13:20:00Z
completed: null
status: in-progress
---

# Inception Log: assisted-dyestuff-weighing-station

## Overview

**Intent**: Build WeighingMS — an assisted dyestuff weighing station application that guides a dyehouse operator through dispensing dyestuffs and dry auxiliaries against an OrgaTEX-issued recipe, records what was actually dispensed, and posts actual consumption back to OrgaTEX.

**Type**: green-field

**Created**: 2026-10-29

**Source artifacts**:
- `docs/brief.md` — Business Requirements Document v1.1 (draft), FCI
- `docs/customize-weighing-station.html` — UI/UX functional prototype

## Artifacts Created

| Artifact | Status | File |
|----------|--------|------|
| Requirements | ✅ Approved (Checkpoint 2) | requirements.md |
| UI Analysis | ✅ Complete (Step 8) | ui-analysis.md |
| System Context | ✅ Complete (Step 9) | system-context.md |
| Units | ✅ Complete (Step 10) — pending Checkpoint 3 | units.md |
| Stories | ⬜ Pending | units/{unit}/stories/*.md |
| Bolt Plan | ⬜ Pending | memory-bank/bolts/bolt-*.md |

## Summary

| Metric | Count |
|--------|-------|
| Functional Requirements | 23 |
| Non-Functional Requirements | 7 groups (18 metric rows) |
| Confirmed Requirements | 14 |
| Binding Assumptions | 10 |
| Unresolved Questions | 12 |
| Dummy APIs | 4 |
| Units | 8 |
| Stories | 0 (37 planned) |
| Bolts Planned | 0 (26 suggested) |

## Units Breakdown

| Unit | Stories | Bolts | Priority |
|------|---------|-------|----------|
| `001-batch-management` | 3 | 2 | S |
| `002-recipe-material-management` | 4 | 3 | M |
| `003-weighing-station` | 9 | 4 | L |
| `004-scale-integration` | 4 | 3 | M |
| `005-orgatex-integration` | 5 | 3 | M |
| `006-ticket-printing` | 5 | 4 | M |
| `007-weighingms-ui` | 5 | 5 | L |
| `008-operator-identity` | 2 | 2 | S |

## Decision Log

| Date | Decision | Rationale | Approved |
|------|----------|-----------|----------|
| 2026-10-29 | Intent name: `001-assisted-dyestuff-weighing-station` | Derived from the BRD title "Assisted dyestuff weighing station"; 3-digit prefix per AI-DLC naming convention | Pending |
| 2026-10-29 | Project type set to `full-stack-web` | The product is a React operator UI plus a Node API serving the Dummy APIs and persisted records | Pending |
| 2026-10-29 | Tech stack: TypeScript strict, React 19 + Vite, Express, Zustand, SQLite (better-sqlite3), Vitest + Playwright | See `memory-bank/standards/tech-stack.md`. Type safety and fixed-point decimal satisfy NFR-16; Vite gives fast iteration across many small bolts | Pending |
| 2026-10-29 | API and UI served as **separate processes on separate ports** with CORS | Mirrors real production topology and structurally enforces the "no hard-coded fixture data in the UI" rule | Pending |
| 2026-10-29 | Dummy Scale delivers weight over **Server-Sent Events at 10 Hz** | IR-10 requires a continuous stream; NFR-01 budgets 200 ms lag. SSE avoids spending latency budget on polling overhead | Pending |
| 2026-10-29 | Dummy APIs treated as **training contracts behind the adapter boundary**, never as assumed real contracts | BRD IR-07 requires OrgaTEX interaction to be confined to one replaceable component; the BRD's own interface questions (A-01, A-02) are unresolved | Pending |
| 2026-10-29 | Intent explicitly states that WeighingMS **does not replace OrgaTEX** | BRD C-01, C-02; the Product Brief's example correction at Checkpoint 1 reinforces this boundary | Pending |

### Checkpoint 1 — Intent Approved

**Date**: 2026-10-29
**Outcome**: APPROVED

All seven workbook criteria confirmed against the generated Intent: business problem,
primary user, desired outcome, scope, UI/UX as a source, dummy integrations, and
identified unknowns.

All decisions recorded above are approved as written. The following carried
assumption was explicitly reviewed and confirmed at Checkpoint 1: **A-05** — the
continuous 10 Hz scale stream is assumed, so the live readout and progress bar are
built as drawn in the supplied prototype. The confirm-and-add fallback was
considered and rejected for this build; it remains the documented contingency if
A-05 is found invalid (BRD R-02).

### Checkpoint 2 — Requirements Approved

**Date**: 2026-10-29
**Outcome**: APPROVED

23 functional requirements and 7 non-functional requirement groups, each traced to
the BRD requirement IDs or to the specific prototype behaviour it derives from.

Verified automatically by `scripts/verify-requirements.cjs`:

- All 20 workbook-mandated functional areas are covered
- Every FR carries a description, binary acceptance criteria, a priority and a traceability line
- All 14 BRD acceptance criteria (AC-01…AC-14) are accounted for
- All 15 BRD assumption IDs are carried forward
- All 4 Dummy APIs are documented as training contracts
- Confirmed requirements, assumptions, unresolved questions and training-only behaviour are in separate sections

### Revisions made during Step 7

Three genuine specification gaps were found by the verifier and closed before
approval:

| Area | Gap | Fix |
|---|---|---|
| FR-3 | Recipe was retrieved but never stated to be **loaded into the weighing session** as the source of truth for what to weigh | Added an explicit acceptance criterion |
| FR-11 | Over-dose behaviour described, but the prototype's own term "overshoot" was absent and the overshoot simulation was not required of the Dummy Scale | Renamed the FR to include overshoot; added the overshoot boundary and the simulation requirement |
| FR-19 | Peripheral **status** was specified but **failure** behaviour was not | Added scale failure (block confirmation, ≤2 s), scanner failure (report, do not silently skip) and printer failure (queue ticket for reprint) |

### Carried forward as not satisfiable in this build

| Criterion | Why | Reference |
|---|---|---|
| AC-10 | Ticket content is a training artefact — the prototype states "Label content is invented" | Q-11, A-04 |
| AC-11 | Requires a real operator achieving competence within one shift | A-14 |
| AC-12 | Requires a paper-process baseline that does not exist yet | A-13, A-14 |

Printer language and barcode symbology were deliberately **not** invented, so the
Dummy Printer stays unambiguous in its inputs while leaving the physical choice
to FCI.

### Step 8 — UI/UX converted into development knowledge

**Date**: 2026-10-30
**Outcome**: COMPLETE

`docs/customize-weighing-station.html` was analysed as a **functional prototype**
and analysed, not redesigned. The analysis is recorded in
`memory-bank/intents/001-assisted-dyestuff-weighing-station/ui-analysis.md`
(13 sections) and in four evidence artefacts under
`evidence/STEP-08-ui-analysis/`, generated by `scripts/step08-ui-analysis.cjs`
(Playwright 1.62.0 / Chromium):

| Artefact | Content |
|---|---|
| `screen-inventory.png` | The three screens (`#v-queue`, `#v-weigh`, `#v-done`) rendered from the prototype itself, with entry conditions and the persistent chrome |
| `component-inventory.png` | The recipe rail as rendered, the 14-field component record, and the seeded B-24187 recipe |
| `state-model.png` | Component lifecycle (pending → active → done) and the four weight zones, the zone→surface mapping, and transitions T-1…T-10 |
| `ai-analysis.png` | BR-1…BR-20 business rules, P-1…P-14 prototype assumptions, Q-01…Q-18 open questions, and build implications |

**What was extracted.** Every rule below was read from the prototype's own
JavaScript and markup, not inferred:

- The `zone()` thresholds — `over` above `target + tol`, `ok` within
  `target ± tol`, `near` above `target × 0.9`, otherwise `under`.
- The `select()` guard — a `done` component is terminal and returns early.
- The confirm handler — `actual = now`, state becomes `done`, and the **first
  pending** component in recipe order is selected automatically.
- The `fmt()` decimal rule — 1 dp for `g`, 3 dp for `kg`.
- The progress-bar scale — percentage is computed against the scale's `max`
  capacity, not against the target; the tolerance band is
  `(target ± tol) / max`.
- The surplus proposal — a proportional 1.026 recalculation of the remaining
  components.
- The synthetic ramp — `step = max(target × 0.004, remaining × 0.055)` on a
  34 ms tick, landing at `target + tol × 0.4` (ok) or `target + tol × 4.8`
  (over). This becomes Dummy Scale behaviour, not UI behaviour.
- The design tokens — `--hmi-bezel`, `--hmi-bg`, `--hmi-panel`,
  `--hmi-panel-2`, `--hmi-line`, `--hmi-ink`, `--hmi-muted`, `--hmi-dim`,
  `--ok`, `--warn`, `--over`, `--steel`.

**What was deliberately not carried over.** The hard-coded component array, the
in-page ramp as a weight source, the meeting-notes and pinned-question chrome,
the hard-coded `ORGATEX · LINKED` status, and the prototype's invented ticket
content. The prototype's own note — *"Label content is invented"* — is recorded
as P-13/Q-12 rather than being turned into a contract.

**Open questions raised by the prototype.** The analysis carries 18 questions
the prototype cannot answer (Q-01…Q-18). These are additions to — not
replacements for — the 12 questions already recorded in `requirements.md`
(Q-01…Q-12), because the prototype exposes its own BRD references in its
tooltips. The union is reviewed in Step 9 (System Context) and Step 11
(Stories).

### Step 9 — System Context

**Date**: 2026-10-30
**Outcome**: COMPLETE

**Artefact**: `memory-bank/intents/001-assisted-dyestuff-weighing-station/system-context.md`
**Evidence**: `evidence/STEP-09-system-context.png` (boundary map) and
`evidence/STEP-09-system-context.md` (evidence note with a coverage checklist).

**Boundary decisions taken.**

| Boundary | Decision |
|---|---|
| Human actors | Six, not two: Operator (primary), Supervisor (privileged), Lab/QA, Store/Inventory, FCI IT, FCI Management. The last four are *consumers of the record or owners of the environment*, not users of the terminal — stating them keeps the record's purpose visible. |
| OrgaTEX | Upstream **and** downstream. Read-only except batch weighing status and consumption posting. Owned by SETEX, a third party. |
| Devices | Two scales (3 kg precision, 32 kg floor), one scanner, one printer — matching the prototype's status strip, which lists both scales separately. |
| Identity source | Drawn as an **undecided** boundary, not as a system we have. Q-08 owns it. |
| Adapter seam | Every external interaction crosses an adapter (BRD IR-07). This is the mechanism that lets a dummy be swapped for a real system without changing the domain. |

**Two judgement calls, both recorded rather than assumed.**

1. **The identity source has no dummy.** The workbook lists four training
   substitutes and this step keeps exactly four. Operator identity is a
   *local* concern of the station — sign-in, role, session — not an external
   integration. Faking it as an external service would misdescribe the
   boundary, so it is drawn as undecided instead.

2. **Three question families are kept apart.** `Q-nn` (BRD, 12) in
   `requirements.md`; `PQ-nn` (prototype, 18) in `ui-analysis.md`; `CQ-nn`
   (raised by drawing the boundaries, 8) in `system-context.md`. **38 in
   total, none silently dropped.** Merging them into one series would discard
   the provenance that tells a reader who can answer each one.

**The eight new context questions** are CQ-01 (station vs shared printer) ·
CQ-02 (identity per shift or per weighing) · CQ-03 (batch split across shifts
or operators) · CQ-04 (two scales or one re-zeroed indicator) · CQ-05
(consumption posted per batch, component or lot) · CQ-06 (is a rejected posting
permanent or retryable) · CQ-07 (is a dashboard or BI export needed) · CQ-08
(do containers carry a lot barcode, or is it keyed in).

**Eleven failure boundaries** were specified, B-1…B-11, each with the
behaviour on failure. The governing rule: **no failure at any boundary may
produce a silently wrong number.** A weight that is not live is shown as not
live; a posting that has not landed is shown as pending, not confirmed. The
prototype's hard-coded `ORGATEX · LINKED` becomes a real link state —
`LINKED`, `DEGRADED` or `OFFLINE`.

**B-5 is the one that changes the product's shape.** If the scales return only
a stabilised value rather than a continuous stream, guided weighing as drawn
is not buildable. It is carried forward explicitly as assumption A-05 rather
than designed around.

**Contracts not invented.** Three of the six external contracts are
undocumented (OrgaTEX A-01/A-02, the scale protocol A-05, the ticket content
Q-11). The document specifies boundaries and directions of data flow, never
contract shapes.

### Step 10 — Unit Decomposition

**Date**: 2026-10-30
**Outcome**: COMPLETE

**Artefacts**:
- `memory-bank/intents/001-assisted-dyestuff-weighing-station/units.md` — the unit
  register, the requirement mapping, the dependency graph, the independence
  validation and the execution order.
- Eight unit briefs under `units/{unit}/unit-brief.md`.
- `evidence/STEP-10-units.png` — the unit register.
- `evidence/STEP-10-unit-map.png` — the dependency map, execution order and
  independence validation.

**The decomposition.** WeighingMS decomposes into **eight units** — seven
backend capability units and one frontend unit — carrying **37 stories**
across **23 functional requirements**.

| # | Unit | FRs | Stories |
|---|------|-----|---------|
| 001 | `batch-management` | FR-1, FR-2 | 3 |
| 002 | `recipe-material-management` | FR-3…FR-6 | 4 |
| 003 | `weighing-station` | FR-7…FR-15, FR-18 | 9 |
| 004 | `scale-integration` | FR-19 (scale half) | 4 |
| 005 | `orgatex-integration` | FR-16, FR-19 (MES half), FR-20 | 5 |
| 006 | `ticket-printing` | FR-17, FR-21, FR-22, FR-23 | 5 |
| 007 | `weighingms-ui` (frontend) | — | 5 |
| 008 | `operator-identity` | — | 2 |

**The three rules applied.** Units are capabilities, not screens and not
layers. A unit is separated when it has its own failure mode, its own change
rate, or its own external contract. Every FR lands in exactly one unit.

**FR-19 is split, explicitly.** It is the one requirement covering two
peripherals with two different failure modes. Its scale half sits in unit
004, its OrgaTEX half in unit 005, its scanner half in unit 002 and its
printer half in unit 006. The requirement is not counted twice.

**Two capabilities were deliberately not created.** The *tolerance / zone
engine* was rejected as a unit because it is a pure value computation with no
state, no persistence, no external contract and no independent failure mode —
and because extracting it would put a network hop between the scale and the
confirm button, against NFR-01's ≤ 200 ms budget. It is a `ToleranceZone`
value object inside unit 003 with its own boundary suite. The *session state*
was rejected because the rule **is** the state transition; splitting them
would create a shared mutable object across a network boundary — the classic
way to lose the DR-02 immutability guarantee.

**"More than a screen" is demonstrated, not asserted.** Unit 003 owns eleven
of the twenty-three FRs and the entire session state machine. Unit 007 owns
**none**. The session API is provable without a UI, and the test suite drives
it directly. If the Weighing Station were a screen, unit 003 would not exist
and unit 007 would carry FR-7 through FR-15.

**Three judgement calls are flagged for Checkpoint 3** rather than presented
as settled: unit 003's size, unit 008's lack of an FR of its own, and the
grouping of the ticket with the audit trail. The reasoning for each is in
`units.md` §Notes for Checkpoint 3.

## Scope Changes

| Date | Change | Reason | Impact |
|------|--------|--------|--------|
| — | None yet | — | — |

## Ready for Construction

**Checklist**:
- [ ] All requirements documented
- [ ] System context defined
- [ ] Units decomposed
- [ ] Stories created for all units
- [ ] Bolts planned
- [ ] Human review complete

## Next Steps

1. Complete Checkpoint 1 — validate and approve the Intent
2. Elaborate detailed Requirements (Step 7)
3. Analyse the UI prototype as a functional prototype (Step 8)
4. Create System Context (Step 9), then decompose into Units (Step 10)
5. Create Stories (Step 11), then plan Bolts (Step 12)

## Dependencies

Inception order: Intent → Requirements → UI analysis → System Context → Units → Stories → Bolt plan.

Construction dependency: units that depend on the OrgaTEX adapter and the scale
integration must be built before the weighing-station UI that consumes them.
