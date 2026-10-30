---
id: 002-filter-batch-queue-by-status
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 002-filter-batch-queue-by-status

## User Story

**As a** dyehouse operator
**I want** to narrow the released batch queue by weighing status
**So that** I can find the batch I am responsible for among many, without reading
every row

## Acceptance Criteria

- [ ] **Given** a queue containing batches in more than one weighing status, **When**
  the operator applies a status filter, **Then** only the batches with that status are
  displayed and the count of displayed rows equals the number of matching batches
  (FR-1, BRD IR-01).
- [ ] **Given** a status filter is applied, **When** the operator selects "All", **Then**
  every batch in the queue is displayed again (FR-1, BRD IR-01).
- [ ] **Given** a filter is applied that matches no batch, **When** the filtered view
  renders, **Then** the UI shows an explicit "no batches match this filter" state and
  zero rows, and not an error (FR-1).
- [ ] **Given** the operator has not chosen a filter, **When** the queue is first
  displayed, **Then** no filter is applied and all batches are shown (FR-1).
- [ ] **Given** a status filter is applied, **When** the filter control is inspected,
  **Then** the available status values are the set of weighing-status values returned
  by the adapter for the current queue, and no status is hard-coded in the client
  (FR-1).
- [ ] **Given** a filter is applied and the queue is subsequently refreshed, **When**
  the refreshed queue arrives, **Then** the active filter remains applied to the
  refreshed rows (FR-1).

## Technical Notes

- **Status values are data, not code.** The set of filterable statuses is derived
  from the statuses present in the queue as returned by the adapter. The set of
  non-`RELEASED` statuses and their eligibility reasons is configuration owned
  elsewhere and is constrained by BRD BR-03 and BRD FR-03 — this story does not
  enumerate statuses it has not been given.
- **Filtering happens on the returned queue**, not by inventing a status field. If the
  adapter supports server-side filtering, the adapter decides; the client must not
  assume a query parameter exists on the upstream contract (Q-01).
- The filter is a presentation concern over an already-fetched queue; it does not
  trigger a write and it does not change what the adapter is permitted to return.
- No quantity values are involved in filtering; should the filter ever carry a
  quantity it must be fixed-point decimal, never float (BRD NFR-16).
- The filtered view must not be mistaken for a separate queue: `receivedAt` remains
  visible and unchanged while a filter is applied, so the operator can still see how
  old the underlying data is.
- All filter labels and the empty-filter message are externalised for translation
  (NFR-7, BRD NFR-11).

## Dependencies
### Requires
- 001-retrieve-released-batch-queue

### Enables
- 003-select-batch-and-record-identity

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Filter value matches a status that has since disappeared from the queue | The filter remains selected and shows zero rows with the explicit no-match message; the operator can return to "All" |
| A batch's weighing status is empty or null | The batch is grouped under an explicit "Unspecified" filter value and is not silently dropped from "All" |
| Status strings differ only by case or whitespace between upstream responses | The value is normalised for comparison and display so one logical status does not split into two filters |
| A large queue is filtered | The full filtered set is shown; no pagination or truncation is applied by this story |
| The adapter rejects a status value it does not recognise | The adapter layer rejects the payload and the UI shows the error state; no status is silently mapped to "All" |
| The operator applies a filter and then refreshes, and the new queue is smaller | The filter is still applied to the new rows; the no-match message appears if nothing matches |

## Out of Scope

- Eligibility gating and the reason a batch cannot be chosen →
  `003-select-batch-and-record-identity`.
- The queue read, the adapter contract and upstream filtering semantics →
  `005-orgatex-integration`.
- Searching by free text, sorting and pagination → not specified by FR-1.
- Layout and control rendering → `007-weighingms-ui`.
