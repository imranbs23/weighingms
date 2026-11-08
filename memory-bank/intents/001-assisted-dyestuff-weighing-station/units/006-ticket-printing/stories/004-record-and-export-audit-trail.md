---
id: 004-record-and-export-audit-trail
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 004-record-and-export-audit-trail

## User Story

**As a** dyehouse supervisor
**I want** every privileged action recorded immutably with who did it and why, and exportable on demand
**So that** a weighing dispute or a compliance review can be settled from the record rather than from recollection

## Acceptance Criteria

- [ ] **Given** a privileged action has occurred, **When** the action completes, **Then** an audit entry exists carrying the action, the actor identifier, the actor's role, the subject acted upon, the reason and the time of occurrence (BRD FR-21, BRD FR-36).
- [ ] **Given** an audit entry exists, **When** any attempt is made to update or delete it, **Then** no update or delete path exists and the entry is unchanged (BRD FR-21, BRD NFR-13, BRD DR-02).
- [ ] **Given** audit entries exist, **When** the trail is queried by actor, action or date range, **Then** only the matching entries are returned, ordered by a monotonic sequence (BRD FR-21).
- [ ] **Given** audit entries exist, **When** the trail is exported with a filter, **Then** an export artefact is produced containing exactly the matching entries with all their fields intact (BRD FR-21, BRD NFR-13).
- [ ] **Given** a privileged action was attempted with no reason, **When** the action is refused, **Then** no audit entry is written for a successful action that did not happen, and the refusal itself is recorded with its reason (BRD FR-21).
- [ ] **Given** audit entries exist, **When** the retention policy is inspected, **Then** entries are retained for a minimum of 5 years (DR-01).

## Technical Notes

- **The audit trail is a domain concept, not a log file.** It is a table with a monotonic sequence, written through one append-only API. The success criterion is a test asserting that no update or delete path exists on the repository, not a convention that callers remember.
- Append-only is enforced in the storage layer (SQLite via `better-sqlite3`, append-only table, no `UPDATE`/`DELETE` statements in the module) so a compromised or buggy caller cannot mutate history.
- **Which actions are privileged is derived from the BRD's own constraints**, not from an invented taxonomy: supervisor tolerance override, manual scale reselection, calibration bypass (BRD FR-35), configuration changes (BRD FR-22), and reprints (BRD FR-28). Story 003 adds reprints.
- The reason is **not optional** on any privileged entry. `recordAudit` rejects an entry with an empty reason. BRD C-09 and NFR-12 both turn on a supervisor authorisation being *justified*; an audit entry without a reason cannot demonstrate justification.
- Audit entries are written by the units that perform the action (003 for overrides, 005 for configuration, this unit for reprints), each through the same append-only API, so the trail has one shape and one ordering.
- Entries carry a `sequence` alongside `occurredAt` so ordering survives clock skew — the sequence is authoritative for order, the timestamp for human reading.
- The export format is a training artefact in this build; it must be complete and machine-readable, but its exact serialisation is not settled by any requirement.
- Power-loss durability: an audit entry survives immediate power loss (NFR-3, BRD NFR-05).

## Dependencies

### Requires
- 003-reprint-ticket-with-reason (the first in-unit consumer of the audit API).
- 008-operator-identity story 002 (the supervisor authorisation that the override audit entry attributes).

### Enables
- 005-change-configuration-and-language (configuration changes are audited).
- 006-report-on-tolerance-failures-and-overrides (the report reads the audit trail for override authorisations).
- Unit 007 story 005 (the audit view and export control).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Two privileged actions occur within the same millisecond | They are ordered by the monotonic sequence, not by timestamp. |
| A privileged action is attempted by an actor whose identity is anonymous | The attempt is refused and a refusal entry records the subject and the stated reason; no successful-action entry is written. |
| The export filter selects no entries | An empty export is produced; it is not an error and it does not fail the request. |
| The database is restored from an older backup | Entries with a sequence above the restored maximum are re-appended with their original timestamps; the trail never silently rewinds. |
| An export is requested for a multi-year range | The export is produced from the store without loading every entry into memory in one buffer. |

## Out of Scope

- Deciding which actions are privileged — derived from BRD FR-35 and BRD FR-22, not defined here.
- The authentication itself — unit 008.
- The reporting read model — story 006.
- The human-facing audit screen — unit 007 story 005.
