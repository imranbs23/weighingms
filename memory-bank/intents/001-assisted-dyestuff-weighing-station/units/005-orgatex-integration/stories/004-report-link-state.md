---
id: 004-report-link-state
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 004-report-link-state

## User Story

**As a** dyehouse operator
**I want** to see at a glance whether the station is talking to the MES
**So that** I know whether the recipe I am working from is live and whether my weighings have reached production, without having to guess

## Acceptance Criteria

- [ ] **Given** the last contact with the MES succeeded, **When** the link state is read, **Then** it is `LINKED` (BRD FR-19, BRD FR-20).
- [ ] **Given** recent contacts have failed but the last successful snapshot is still within its freshness window, **When** the link state is read, **Then** it is `DEGRADED` (BRD FR-19, BRD FR-20).
- [ ] **Given** the station cannot reach the MES, **When** the link state is read, **Then** it is `OFFLINE` (BRD FR-19, BRD FR-20).
- [ ] **Given** the link state is read, **When** it is returned, **Then** it carries the last successful contact time, the last error and the consecutive failure count (BRD FR-19, BRD FR-20).
- [ ] **Given** the link state is `DEGRADED` or `OFFLINE`, **When** the number of un-synchronised records is read, **Then** it is reported, and any snapshot served is shown with its age rather than presented as current (BRD FR-20, BRD FR-32).
- [ ] **Given** the link state changes, **When** the change occurs, **Then** the previous state, the new state and the time of the transition are recorded (BRD FR-19).

## Technical Notes

- **The link state is three-valued, and each state has a defined consequence:**

  | State | Meaning | Consequence |
  |---|---|---|
  | `LINKED` | The last contact succeeded | Reads and writes proceed normally. |
  | `DEGRADED` | Recent contacts failed, but the last successful snapshot is still within its freshness window | Reads serve the last snapshot, clearly marked with its age; writes queue. |
  | `OFFLINE` | The station cannot reach the MES | Reads fail loudly; writes queue; weighing continues. |

- **The link state is real, never hard-coded.** The prototype's hard-coded `ORGATEX · LINKED` becomes a real state with real consequences (C-10).
- **The governing rule from the system context: no failure at any boundary may produce a silently wrong number.** Concretely — a queued write is shown as *pending*, never as *posted*; a stale snapshot is shown with its age, never as *current*.
- The link state is a **property of the boundary**, decided here and consumed everywhere else. No other unit computes it, and no other unit talks to the MES directly (BRD IR-07).
- `LinkState` fields: `status`, `lastContactAt`, `lastError`, `consecutiveFailures`.
- The **freshness window** that separates `DEGRADED` from `OFFLINE` is a configured value, not a hard-coded constant. It determines how long a stale snapshot may still be served, and therefore how old the data behind a `DEGRADED` badge may be.
- **Weighing continues in every link state.** `OFFLINE` is a condition of the *link*, not of the station (BRD FR-20, BRD NFR-03). The state changes what the MES-facing operations do — reads and writes — not whether the operator can weigh.
- The state is derived from **observed contact outcomes**, not from an assumption about connectivity. A station that has never contacted the MES is `OFFLINE`, not `LINKED`.
- The un-synchronised record count is the count of the durable queue's unlanded entries (story 005).
- Transitions must be covered by a test per state, **including `DEGRADED` → `OFFLINE` and back**.
- The prototype's status strip lists both scales, the scanner and the printer. The **OrgaTEX half** of that strip is owned here; the scale half is unit 004, the scanner half is unit 002 and the printer half is unit 006.

## Dependencies

### Requires
- 001-read-released-batch-queue (the first contact outcome that establishes the state)

### Enables
- 005-queue-writes-offline-and-sync-on-recovery (the state that decides whether a write is sent or queued)
- 002-read-batch-recipe (the read's behaviour in each state)
- 007-weighingms-ui (the peripheral status strip)
- 001-batch-management (the age of the queue it displays)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The station has never contacted the MES | The state is `OFFLINE`, with no last-contact time and no snapshots served. |
| A contact succeeds after failures | The state returns to `LINKED`, the consecutive failure count resets to zero, and the last error is cleared. |
| The state moves from `DEGRADED` to `OFFLINE` | The last successful snapshot ages out of its freshness window; reads now fail loudly rather than serving a stale snapshot. |
| The state moves from `OFFLINE` back to `DEGRADED` | The first successful contact makes the state `DEGRADED` until a subsequent contact succeeds — or `LINKED` directly, if the first contact establishes a healthy link. |
| The MES responds with an error | The state reflects the failure, the last error is recorded, and the consecutive failure count increments. An error response is a failed contact. |
| The link flaps between success and failure | Each transition is recorded with its time; the state reflects the most recent outcome, and the consecutive failure count is the authority on the current streak. |
| The MES is slow but eventually responds within the timeout | The contact counts as successful; the state is unaffected. |
| A queued write exists and the state is `DEGRADED` | The un-synchronised count is reported, and the queued write is shown as *pending*. |
| The freshness window is configured to zero | The state transitions from `DEGRADED` to `OFFLINE` on the first failure, because no stale snapshot is ever fresh enough to serve. |
| The link state is read while a flush is in progress | The state reflects the link, not the flush; the flush's progress is reported separately by story 005. |

## Out of Scope

- The queue, its retry policy and the flush on recovery — story 005.
- The queue and recipe reads — stories 001 and 002.
- The consumption posting and its idempotency contract — story 003.
- The scale, scanner and printer status — units 004, 002 and 006 respectively.
- Rendering the status strip — `007-weighingms-ui`.
