---
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Batch Management

## Purpose

Own the set of batches this station may work on, and the act of choosing one.

A batch is the unit of work in a dyehouse: an order, a machine, a fabric, a
shade, and a recipe. This unit answers two questions and only two: *which
batches am I allowed to work on?* and *which one has the operator chosen?*

Everything after the choice — what is in it, what it weighs, what is printed —
belongs to other units.

## Scope

### In Scope

- Retrieving the released batch queue from OrgaTEX and presenting it.
- The queue's display columns: batch ID, order reference, machine reference,
  fabric description, shade code, component count, weighing status.
- The time the queue was last received.
- Filtering the queue by status.
- **Eligibility gating** — a batch not in `RELEASED` state cannot be
  selected, and the reason is shown to the operator.
- Selection by barcode scan or by touching a row.
- The batch identity as it appears in the topbar crumb (batch, order, machine).

### Out of Scope

- The recipe's contents and the materials in it → `002-recipe-material-management`.
- Anything about weighing → `003-weighing-station`.
- The queue read itself and the MES contract → `005-orgatex-integration`.
- Rendering the queue → `007-weighingms-ui`.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Batch queue retrieval and display | Must |
| FR-2 | Batch selection by barcode or touch | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `Batch` | A dye batch released for weighing | `id`, `orderRef`, `machineRef`, `fabricDescription`, `shadeCode`, `componentCount`, `status`, `releasedAt` |
| `BatchQueue` | The projection of released batches at a point in time | `batches[]`, `receivedAt` |
| `BatchSelection` | The operator's chosen batch for this session | `batchId`, `selectedAt`, `selectedBy`, `selectionMethod` (`SCAN` \| `TOUCH`) |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `getBatchQueue` | Fetch the released queue through the OrgaTEX adapter | filter (optional status) | `BatchQueue` with `receivedAt` |
| `selectBatch` | Record the operator's choice of a batch | `batchId`, operator id, method | `BatchSelection`, or a rejection with a reason |
| `isEligible` | Decide whether a batch may be selected | `Batch` | eligible / not eligible + reason |
| `resolveScan` | Turn a scanned code into a batch id | barcode string | `batchId`, or an unknown-code outcome |

### The eligibility rule

A batch is selectable only when its status is `RELEASED`. Any other status
yields a **specific reason**, not a generic rejection — the operator must be
told *why* the batch cannot be worked. Reasons include: not yet released,
already weighed, on hold, or belonging to another station.

**Rule 2 (workbook): no invented requirements.** The set of non-`RELEASED`
statuses and their reasons is constrained by BRD BR-03 and FR-03. Where the
BRD does not name a status, the reason is derived from the status rather than
invented, and the mapping is configuration, not code.

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 3 |
| Must Have | 3 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | View the released batch queue | Must | Planned |
| 002 | Filter the queue by weighing status | Must | Planned |
| 003 | Select a batch by scan or touch | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| `005-orgatex-integration` | The queue is read through the OrgaTEX adapter — this unit never talks to the MES directly (BRD IR-07). |
| `002-recipe-material-management` | Selecting a batch loads its recipe, which unit 002 owns. |
| `008-operator-identity` | The selection is attributed to an operator. |

### Depended By

| Unit | Reason |
|------|--------|
| `003-weighing-station` | The weighing session needs the selected batch. |
| `006-ticket-printing` | The ticket carries the batch, order and machine identity. |
| `007-weighingms-ui` | Renders the queue and the selection. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| OrgaTEX MES | Supplies the released batch queue | **Severe** — A-01, Q-01. The contract is undocumented; the unit is written against the adapter's interface, not the MES's shape. |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3 for the selection record · no floating point for any quantity.
Full rationale in `memory-bank/standards/tech-stack.md`.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `005-orgatex-integration` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON |
| OrgaTEX MES | API (external, via adapter) | REST/JSON — **assumed shape, not confirmed** |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Batch queue | Not persisted — projected live from OrgaTEX | — | — |
| Batch selection | SQL | One row per selection | Session-scoped; superseded on re-selection |

**The queue is not cached in this unit.** Caching policy belongs to unit 005,
which owns the link state and therefore knows whether what it returns is
current. Duplicating a cache here would create two sources of truth for the
same queue.

---

## Constraints

- The queue is **never embedded in the client** (FR-1). All of it arrives
  over the API.
- A batch not in `RELEASED` state cannot be selected, and the reason is shown
  (FR-1, BRD BR-03).
- OrgaTEX interaction is confined to the adapter (BRD IR-07).
- The queue is read-only from this unit's perspective — this unit never
  modifies a batch in OrgaTEX.
- Selection is by **scan or touch**, and the method is recorded, because a
  scanned selection and a touched one have different traceability meaning.

---

## Success Criteria

### Functional

- [ ] The queue displays all seven columns from FR-1.
- [ ] The time the queue was last received is displayed.
- [ ] The queue can be filtered by status.
- [ ] A batch not in `RELEASED` cannot be selected and the reason is shown.
- [ ] A batch can be selected by scanning its card and by touching its row.
- [ ] The selection is recorded with the operator and the method.

### Non-Functional

- [ ] Batch selection to recipe displayed ≤ 3 s when online (NFR-1, AC-01).
- [ ] The queue renders from API data only; no batch is hard-coded anywhere
      in the client.
- [ ] All operator-facing text externalised for translation (NFR-7).

### Quality

- [ ] All acceptance criteria met.
- [ ] The eligibility rule has an exhaustive test per status.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

> Generated from the bolt plan in `memory-bank/bolts/` by
> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**
> sequence across all units, not a per-unit one.

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `008-001-batch-management` | DDD | 001-retrieve-released-batch-queue | Read the released batch queue through the OrgaTEX adapter and expose it as a station-owned projection with… |
| `009-001-batch-management` | DDD | 002-filter-batch-queue-by-status, 003-select-batch-and-record-identity | Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the me… |

---

## Notes

**Open questions touching this unit.** Q-01 (does SETEX provide a documented
interface) and Q-04/Q-05 are upstream of it. The BRD's §9.2 records the
question of what can be *read* from OrgaTEX — queue, recipe, dyestuff master,
tolerances, tare, lot data — and this unit's scope depends on the answer for
the queue fields specifically.

**CQ-02 and CQ-03 touch this unit indirectly.** CQ-02 asks whether operator
identity is established per shift or per weighing; CQ-03 asks whether a batch
can be split across shifts or operators. If a batch *can* be split, then
"selecting a batch" is not the same as "starting a batch", and a selection may
be resumed rather than created. **This unit stores the selection, but the
resume semantics belong to unit 003** — which owns the session that is
resumed.

**Why this is not part of the Weighing Station.** The queue is a projection
of a system WeighingMS does not own, with its own refresh and staleness
behaviour. Its change rate is driven by OrgaTEX releases, not by the
station's UI. Isolating it means a change to OrgaTEX's release rules touches
one unit rather than the whole flow.
