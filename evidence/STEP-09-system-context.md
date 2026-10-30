# STEP-09 — System Context (evidence note)

**Intent**: `001-assisted-dyestuff-weighing-station`
**Phase**: Inception
**Status**: context-defined
**Date**: 2026-10-30

This file is the evidence pointer for Step 9. The full, authoritative document is
the memory-bank artefact:

> **`memory-bank/intents/001-assisted-dyestuff-weighing-station/system-context.md`**

## Artefacts

| Artefact | Path | Contents |
|---|---|---|
| System context document | `memory-bank/intents/001-assisted-dyestuff-weighing-station/system-context.md` | Actors, external systems, data flows, context diagram, integration and failure boundaries, constraints, NFR goals, open questions |
| Boundary map | `evidence/STEP-09-system-context.png` | Rendered diagram of the same content — human actors, real external systems, the WeighingMS system lane, training substitutes, inbound/outbound data, ownership, and the 11 failure boundaries |

**Diagram source**: `scripts/step09-system-context.cjs` (Playwright 1.62.0 / Chromium).
Regenerate with `npm run evidence:step09`.

## Coverage against the workbook's Step 9 checklist

| Required | Where | Note |
|---|---|---|
| Human actors — Operator | § Actors | *Weighing operator* — primary; gloved hands, dusty dyehouse, limited computer literacy |
| Human actors — Supervisor | § Actors | *Dyehouse supervisor* — privileged; authenticates for overrides |
| Systems — WeighingMS | § System Overview, § Context Diagram | The system being built; owns session, zone judgement, recorded weighing fact, ticket, audit trail |
| Systems — OrgaTEX | § External Systems | Upstream **and** downstream; owned by SETEX; contract undocumented |
| Devices — Scale | § External Systems | Two instances: 3 kg precision, 32 kg floor; continuous weight + stability flag |
| Devices — Scanner | § External Systems | Batch / material / lot identification |
| Devices — Printer | § External Systems | Weighing ticket and label |
| Training substitute — Dummy OrgaTEX API | § Training substitutes | Behind the adapter boundary |
| Training substitute — Dummy Scale API | § Training substitutes | Behind the scale-adapter boundary |
| Training substitute — Dummy Scanner | § Training substitutes | Behind the scanner-adapter boundary |
| Training substitute — Dummy Printer | § Training substitutes | Behind the printer-adapter boundary |
| Inbound data | § Data Flows → Inbound | I-1 … I-6, with validation at each boundary |
| Outbound data | § Data Flows → Outbound | O-1 … O-6, with the guarantee each one carries |
| Ownership | § Context Diagram; § System Overview | Who owns what; a dedicated ownership table in the PNG |
| Integration boundaries | § Integration and Failure Boundaries | B-1 … B-11, one per crossing point |
| Failure boundaries | § Integration and Failure Boundaries | B-1 … B-11, each with the system's behaviour on failure |
| Real vs dummy distinguished | § Context Diagram; § Training substitutes | Real systems drawn solid, dummies drawn dashed; the boundary-map PNG makes this the primary visual distinction |

## Two judgement calls recorded

**1. The identity source has no dummy.** The workbook lists four training
substitutes and this document keeps exactly four. Operator identity is *not* a
dummy because it is a **local concern of the station** (sign-in, role,
session), not an external integration — faking it as an external service would
misdescribe the boundary. The real directory source (Q-08) remains an open
question, but it is drawn as an *undecided* boundary, not as a system we
pretend to have.

**2. Three question families are kept apart.** The workbook requires unresolved
questions to be identified explicitly. Merging them into one series would
discard their provenance — and provenance is what tells a reader who can
answer each one:

| Family | Source | Where | Count |
|---|---|---|---|
| `Q-nn` | BRD v1.1 §9 | `requirements.md` | 12 |
| `PQ-nn` | the UI/UX prototype's own pinned questions | `ui-analysis.md` | 18 |
| `CQ-nn` | raised by drawing the boundaries in this step | `system-context.md` | 8 |

**38 questions in total, none silently dropped.** The 8 new context questions
(CQ-01 … CQ-08) each carry an owner and the boundaries they affect.

## The boundary fact that constrains construction

Three of the six external contracts are **undocumented**: OrgaTEX (A-01,
A-02, Q-01, Q-02), the scale protocol (A-05, Q-03), and the ticket content
(Q-11). The document therefore specifies **boundaries and directions of data
flow, never contract shapes**. No real external API is invented anywhere.

This is not a gap to be papered over during construction — it is the reason
every external interaction passes through an adapter (BRD IR-07). The dummy
implements the contract; the adapter owns it; repointing the adapter swaps
dummy for real without anything above the seam changing.

**B-5 is the one failure that changes the product's shape.** If the scale
indicators return only a stabilised value rather than a continuous stream,
guided weighing as drawn in the prototype is not buildable — the interaction
changes, not just the pixels. That risk is carried forward explicitly as
assumption A-05 rather than being designed around.

## Rule compliance

| Rule | How this step complies |
|---|---|
| Rule 1 — specify before coding | No code written. This step produces a specification artefact. |
| Rule 2 — no silent invention | 8 new questions recorded with owners; the three undocumented contracts are stated as undocumented rather than assumed. |
| Rule 3 — AI proposes, human validates | System context is presented for your confirmation at Checkpoint 3. |
| Rule 4 — no bypassed checkpoints | Step 9 has no individual checkpoint by design (AI-DLC batches Context, Units, Stories and Bolts for review at Checkpoint 3). |
| Rule 5 — dummies are real artefacts | The dummies are specified as product surfaces reachable only through the adapter boundary, with an explicit no-claims rule. |
| Rule 6 — must be demonstrable | Every data flow named here has a Dummy API behind it that will be exercised in construction and demonstrated in the E2E suite. |

## Sources

- `docs/brief.md` — BRD v1.1, FCI
- `docs/customize-weighing-station.html` — UI/UX functional prototype
- `memory-bank/intents/001-assisted-dyestuff-weighing-station/requirements.md` — approved at Checkpoint 2
- `memory-bank/intents/001-assisted-dyestuff-weighing-station/ui-analysis.md` — Step 8
- `memory-bank/standards/tech-stack.md` — approved project standards
