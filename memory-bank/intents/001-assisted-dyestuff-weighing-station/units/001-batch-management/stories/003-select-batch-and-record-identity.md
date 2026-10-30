---
id: 003-select-batch-and-record-identity
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 003-select-batch-and-record-identity

## User Story

**As a** dyehouse operator
**I want** to choose a batch by scanning its card or touching its row, and to be told
exactly why a batch I cannot work on is unavailable
**So that** I start the right work and never lose time to an unexplained refusal

## Acceptance Criteria

- [ ] **Given** a batch in `RELEASED` status, **When** the operator scans its barcode,
  **Then** that batch is selected and the selection is recorded with the method
  `SCAN` (FR-2, BRD FR-02, BRD BR-02).
- [ ] **Given** a batch in `RELEASED` status, **When** the operator touches its row in
  the queue, **Then** that batch is selected and the selection is recorded with the
  method `TOUCH` (FR-2, BRD FR-02).
- [ ] **Given** a batch whose status is not `RELEASED`, **When** the operator attempts
  to select it by scan or by touch, **Then** the selection is refused and the specific
  reason it cannot be worked is shown to the operator — the reason names the actual
  cause (not yet released, already weighed, on hold, or belonging to another station)
  and never a generic "not available" message (FR-1, FR-2, BRD BR-03, BRD FR-03).
- [ ] **Given** a scan of an identifier that is not in the queue, **When** the scan is
  resolved, **Then** the scan is rejected with a visible reason stating that the code
  is not recognised, and no batch is selected and no recipe is loaded (FR-2,
  BRD FR-03).
- [ ] **Given** a successful selection, **When** the selection is stored, **Then** the
  record contains the batch ID, the operator ID, the selection timestamp and the
  selection method, and the batch, order and machine identity are shown in the topbar
  crumb (FR-2, BRD FR-34).
- [ ] **Given** a successful selection, **When** the recipe for the selected batch is
  requested, **Then** the recipe is displayed within 3 seconds while the upstream
  system is online (NFR-1, AC-01).

## Technical Notes

- **Eligibility rule.** A batch is selectable only when its status is `RELEASED`.
  Every other status must yield a *specific* reason (BRD BR-03, BRD FR-03). Where the
  BRD does not name a status, the reason is **derived from the status**, not invented,
  and the status→reason mapping is **configuration**, not code.
- **Scan resolution.** The scanner is reached through the adapter boundary. The
  Dummy Scanner's `POST /api/scan` is a training contract behind that boundary; this
  unit asserts no external endpoint shape or payload (Q-01, A-01, A-10).
- **Scan vs touch is recorded, not cosmetic.** The two have different traceability
  meaning, so `selectionMethod` is persisted as `SCAN` or `TOUCH` and is retrievable
  later.
- **Selection persistence.** One row per selection; a new selection supersedes the
  previous one. Storage for the record is a local SQL store (better-sqlite3).
- **CQ-02 / CQ-03 caveat.** This unit stores the selection; it does not define
  "starting a batch". If a batch can be split across shifts or operators (CQ-03), a
  selection may be *resumed* rather than created — that resume semantics belong to
  unit `003-weighing-station`, which owns the session. The selection record therefore
  carries enough information to be resumed, but the resume decision is not made here.
- The selection triggers the recipe load owned by unit
  `002-recipe-material-management`; this unit invokes it and does not own the
  component data.
- All operator-facing rejection reasons and messages are externalised for translation
  (NFR-7, BRD NFR-11).
- No quantity fields are involved in selection; where one later appears it must be
  fixed-point decimal, never float (BRD NFR-16).

## Dependencies
### Requires
- 001-retrieve-released-batch-queue
- 002-filter-batch-queue-by-status

### Enables
- 001-retrieve-recipe-and-component-list (unit 002)
- 003-weighing-station (unit 003)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The scanner is disconnected or returns an unreadable code | The failure is reported to the operator and the affected step is not silently skipped; the operator may fall back to touching the row (BRD FR-19, BRD IR-15, BRD IR-18) |
| A scan resolves to a batch that is present but not `RELEASED` | Selection is refused with the status-specific reason; no recipe is loaded (FR-2, BRD BR-03) |
| A scan resolves to a batch in `RELEASED` status that is not in the currently displayed (filtered) queue | The selection succeeds, because eligibility is governed by status, not by the current filter; the queue filter is a view concern only |
| The operator touches a different row while a selection already exists | The new selection is recorded and supersedes the previous one; the crumb updates to the newly selected batch |
| The operator attempts to select the same batch twice by touch | The selection is idempotent in effect — one active selection remains, with the latest method and timestamp recorded |
| The adapter rejects the scan request with an error | The rejection reason is surfaced with the upstream error detail; no selection is recorded |
| A batch status changes to non-`RELEASED` between the queue refresh and the selection attempt | The eligibility decision is made against the status known at the time of the attempt, and the reason shown reflects the status that caused the refusal |

## Out of Scope

- Retrieving and displaying the queue → `001-retrieve-released-batch-queue`.
- Filtering by status → `002-filter-batch-queue-by-status`.
- The recipe, its components and material identity → `002-recipe-material-management`.
- Resuming or owning the weighing session → `003-weighing-station`.
- Operator authentication and shift-level identity → `008-operator-identity`.
- The scanner seam and its failure handling in general → `005-orgatex-integration`.
