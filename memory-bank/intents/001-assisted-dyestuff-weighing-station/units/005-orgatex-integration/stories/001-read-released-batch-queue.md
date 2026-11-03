---
id: 001-read-released-batch-queue
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: 005-005-orgatex-integration
implemented: true
---

# Story: 001-read-released-batch-queue

## User Story

**As a** dyehouse operator
**I want** the list of batches waiting for me to come from the MES rather than from a printout
**So that** the queue I am working from is the one production actually released, not a copy someone printed hours ago

## Acceptance Criteria

- [ ] **Given** the station asks for the batch queue, **When** the read completes, **Then** the returned snapshot contains each released batch's batch id, order reference, machine reference, fabric description, shade code, component count and weighing status, together with the time the snapshot was received (FR-1).
- [ ] **Given** the queue is read, **When** the read completes, **Then** the snapshot records the time it was received and the source it came from, so that its age is always knowable (FR-1, BRD FR-20).
- [ ] **Given** a filter by status is supplied, **When** the queue is read, **Then** only batches with that status are returned (FR-1, BRD IR-01).
- [ ] **Given** the MES cannot be reached, **When** the queue is read, **Then** the read fails loudly with the error, and the last successful snapshot is served only when the link state is `DEGRADED`, marked with its age — never presented as current (BRD FR-20).
- [ ] **Given** a batch in the returned snapshot is not in `RELEASED` state, **When** the batch is inspected, **Then** its eligibility state is reported so that the caller can refuse to select it with a stated reason (FR-1, BRD BR-03).

## Technical Notes

- **All OrgaTEX interaction is confined to this adapter** (BRD IR-07, C-13). No other unit reads the MES directly, and no other unit imports a client for it. Unit 001 (`001-batch-management`) obtains the queue *through this adapter*.
- **The external contract is not confirmed.** A-01 assumes SETEX provides a documented, licensed REST interface; **Q-01 asks whether such an interface exists at all, and of what kind**. The BRD's own endpoint list is marked *"assumed endpoint shape — illustrative, for FCI/SETEX to correct"*. Accordingly: **describe the adapter seam and the direction of data flow only.** No specific external endpoint, payload shape or field name is asserted here as fact.
- The direction of flow for this story is **read-only**: MES → adapter → snapshot. WeighingMS never writes a batch field other than the weighing status (C-01).
- `BatchQueueSnapshot` fields: `batches[]`, `receivedAt`, `source`. The snapshot is **not persisted** — it is a projection of a system the station does not own and can always re-fetch. (The sync queue in story 005 *is* persisted, and the asymmetry is deliberate.)
- The snapshot carries the batch's **weighing status** because the MES owns it and WeighingMS only advances it on completion (story 003). WeighingMS is read-only against every other batch field (BRD §9.2).
- **The Dummy OrgaTEX is a real artefact, not a mock.** It holds a coherent, mutable world — batches with statuses, recipes with components and tolerances, and consumption it accumulates — so the same UI can be driven through a normal weighing, a rejection, and an outage. It is independently exercisable (for example over `curl`) and is exercised by the test suite. No dummy data is hard-coded into the UI.
- All quantities in a queue snapshot are fixed-point decimal (BRD NFR-16). The queue itself carries no weights; the rule applies to every quantity that crosses the adapter seam.
- The read is **not** a blocking dependency for weighing. A failure here is a failure of the *read*, and the station's response to it is the link state (story 004) and the queue (story 005).

## Dependencies

### Requires
- None (first story)

### Enables
- 002-read-batch-recipe (the same adapter and the same link state)
- 001-batch-management (the operator's queue of work)
- 004-report-link-state (the contact outcome that feeds the link state)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The MES returns an empty queue | An empty snapshot is returned with its received time — not an error, and not a cached previous queue presented as current. |
| The MES returns a batch that is not `RELEASED` | The batch is returned with its eligibility state, and the caller can refuse it with a stated reason (BRD BR-03). |
| The MES responds slowly | The read times out with a stated error; the link state's consecutive-failure count increases and the state may move to `DEGRADED` or `OFFLINE`. |
| The MES returns a malformed record | The snapshot fails validation and the read errors loudly; a partially valid snapshot is never served. |
| A batch was released after the last snapshot | It does not appear until the next successful read. The snapshot's age makes this visible. |
| The same batch appears with a changed status in a later snapshot | The newer snapshot supersedes the older one; there is only ever one queue in the system, owned here. |
| The MES is unreachable and the link state is `OFFLINE` | The read fails loudly. A stale snapshot is served only in `DEGRADED`, and only with its age displayed. |
| The MES is unreachable and there is no prior snapshot at all | The read fails loudly with the error and there is no fallback content — an empty queue is never substituted for "unknown". |

## Out of Scope

- Selecting a batch, scanning its barcode, and the eligibility state machine — `001-batch-management`.
- Reading a batch's recipe and its components — story 002.
- Posting consumption and advancing the weighing status — story 003.
- The link state model itself — story 004.
- The offline write queue and its retry policy — story 005.
- Rendering the queue — `007-weighingms-ui`.
