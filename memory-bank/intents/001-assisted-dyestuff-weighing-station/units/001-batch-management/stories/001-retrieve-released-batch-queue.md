---
id: 001-retrieve-released-batch-queue
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 001-retrieve-released-batch-queue

## User Story

**As a** dyehouse operator
**I want** to see the batches released for this station, with their full identifying
details and the time the list was received
**So that** I can pick the correct work for the current shift without consulting a
paper printout

## Acceptance Criteria

- [ ] **Given** the operator opens the batch queue, **When** the queue is requested,
  **Then** the system returns the released batch queue through the OrgaTEX adapter and
  the response carries a `receivedAt` timestamp identifying when the queue was last
  received from the upstream system (FR-1, BRD FR-01, BRD FR-04).
- [ ] **Given** a queue containing a batch, **When** the queue is rendered, **Then**
  each batch row displays all seven of: batch ID, order reference, machine reference,
  fabric description, shade code, component count and weighing status (FR-1,
  BRD FR-01, BRD FR-04, C-04).
- [ ] **Given** the queue has been received, **When** the queue view is rendered,
  **Then** the time the queue was last received is displayed to the operator
  (FR-1).
- [ ] **Given** the OrgaTEX adapter is unreachable or returns an error, **When** the
  queue is requested, **Then** the request fails with a distinguishable error state
  and the UI shows an error message rather than an empty queue (FR-1, BRD IR-09).
- [ ] **Given** the queue is rendered, **When** the network request is inspected,
  **Then** the batch data arrives over the API and no batch row is hard-coded in the
  client (FR-1, BRD IR-07).
- [ ] **Given** a batch selection completes, **When** the recipe is requested for the
  selected batch, **Then** the recipe is displayed within 3 seconds while the upstream
  system is online (NFR-1, AC-01).

## Technical Notes

- **Source of truth**: the queue is read only through the OrgaTEX adapter. This unit
  never contacts the MES directly (BRD IR-07, C-13). The adapter's interface is our
  own; no external endpoint shape or payload is asserted here (Q-01, A-01).
- **No caching in this unit.** Cache/link-state policy belongs to unit
  `005-orgatex-integration`, which owns whether the returned queue is current.
  Duplicating a cache here would create two sources of truth for one queue.
- **No fake data in the client.** All rows originate from the adapter response; the
  Dummy OrgaTEX stands in behind the adapter boundary as a training contract only.
- `componentCount` and `weighingStatus` are rendered exactly as supplied by the
  adapter; this unit does not derive them from the recipe.
- `receivedAt` is supplied by the adapter response, not computed by the client, so the
  displayed time reflects the upstream receipt time rather than the render time.
- All operator-facing strings are externalised for translation (NFR-7, BRD NFR-11).
- No quantity fields are carried in the queue payload; where a future column needs a
  quantity it must use fixed-point decimal, never float (BRD NFR-16).

## Dependencies
### Requires
- None (first story of this unit)

### Enables
- 002-filter-batch-queue-by-status
- 003-select-batch-and-record-identity
- 001-retrieve-recipe-and-component-list (unit 002)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The adapter returns an empty batch list | The queue renders with zero rows and a visible "no released batches" message; `receivedAt` is still displayed |
| The adapter times out or returns 5xx | The request fails with a distinguishable error state; the UI shows an error and does not present an empty queue as if it were authoritative |
| A batch is missing one of the seven fields | The row renders with an explicit placeholder for the missing field; the row is not silently dropped |
| The queue was received a long time ago | `receivedAt` is displayed as returned; whether a stale queue is still usable is a unit 005 concern and is not decided here |
| Two batches share a batch ID but differ in order reference | Both rows are displayed; the operator distinguishes them by order reference, and the eligibility rule evaluates each row independently |
| A component count arrives as a non-numeric value | The adapter layer rejects the payload as invalid; the UI shows the error state, not a zero count |

## Out of Scope

- Filtering the queue by status → `002-filter-batch-queue-by-status`.
- Selecting a batch and the eligibility gate → `003-select-batch-and-record-identity`.
- The queue read itself, the MES contract and caching policy →
  `005-orgatex-integration`.
- Rendering concerns and layout → `007-weighingms-ui`.
- The recipe contents of a batch → `002-recipe-material-management`.
