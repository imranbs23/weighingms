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
| System Context | ⬜ Pending | system-context.md |
| Units | ⬜ Pending | units.md |
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
| Units | 0 |
| Stories | 0 |
| Bolts Planned | 0 |

## Units Breakdown

| Unit | Stories | Bolts | Priority |
|------|---------|-------|----------|
| *To be determined in Step 10* | | | |

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
