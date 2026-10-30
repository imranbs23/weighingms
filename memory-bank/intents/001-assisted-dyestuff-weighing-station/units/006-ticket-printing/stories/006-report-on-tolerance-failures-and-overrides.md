---
id: 006-report-on-tolerance-failures-and-overrides
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: should
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 006-report-on-tolerance-failures-and-overrides

## User Story

**As a** dyehouse supervisor
**I want** to report on tolerance failures and overrides over a period
**So that** I can see the failure rate and the overrides I authorised without walking to the station

## Acceptance Criteria

- [ ] **Given** a specified period (a date range or a named shift), **When** the report is requested, **Then** the report returns the tolerance failures and the supervisor-authorised overrides recorded within that period (FR-23, BRD FR-23, BRD BR-23).
- [ ] **Given** a specified period, **When** the report is built, **Then** every row is derived from the immutable weighing records and the audit trail, and **not** by re-deriving tolerance from the recipe (FR-23, BRD FR-23, BRD DR-02).
- [ ] **Given** a specified period in which no tolerance failure and no override occurred, **When** the report is requested, **Then** the report returns a count of zero for both and does **not** return an error (FR-23, BRD FR-23).
- [ ] **Given** an override appears in the report, **When** the row is read, **Then** it carries the subject weighed, the actor who authorised it, the role, the reason and the time (FR-21, FR-23, BRD FR-21, BRD FR-23).
- [ ] **Given** the report is requested, **When** it is returned, **Then** no weighing record, audit entry or configuration value has been created, updated or deleted by the request (FR-23, BRD FR-23, BRD DR-02).
- [ ] **Given** a specified period, **When** the report is requested, **Then** the report also states the batch weighing progress for that period, so a supervisor can see where batches are without visiting the station (FR-23, BRD FR-23, BRD BR-22).

## Technical Notes

- **This story is the implementation of our FR-23** (operational reporting: the business can report on tolerance failures and overrides over a period), and it draws on our FR-21 for the override authorisation it reports. The BRD's own `FR-23` and `BR-22` are the upstream source of the same need; citing only those would leave our own FR-23 looking unimplemented.
- **The report is a read model.** It is a query over the immutable weighing records and the append-only audit trail; it mutates nothing. A report request must not create, update or delete a record of any kind, including a "report generated" audit entry — the report is not a privileged action.
- **The report is never re-derived from the recipe.** The tolerance outcome is read from the zone recorded at confirmation on the weighing record (BRD FR-18), not recomputed from the current recipe and the current tolerance configuration. A recipe or tolerance revision after the fact must not change what the report says happened. This is the same immutability principle as BRD FR-18 and BRD DR-02, and it is the reason the report is trustworthy after a configuration change.
- The period is an input to the query, expressed as a date range or a shift. It is not a stored snapshot, because nothing is snapshotted: the records are already immutable.
- A zero-failure period is a valid, meaningful result — the absence of a failure is itself reportable — and must not be reported as an error or an empty-but-broken response.
- "Overrides" in this report means **supervisor-authorised overrides**, which are the entries in the audit trail where a supervisor authorised an out-of-tolerance over-dose. The report joins those audit entries to the weighing record they refer to; the audit entry alone is not sufficient, because the subject is what makes the row meaningful.
- **CQ-07 is explicitly not answered by this story.** Whether the dyehouse needs a dashboard or a BI-tool export is an open context question; a BI integration would be a **new outbound flow**, not a new context. This story covers the reporting need — queryable, period-scoped, derived from immutable records — without inventing a BI integration, a dashboard product or an outbound contract. A future dashboard is a consumer of this read model.
- The report's presentation format (table, chart, file) is not specified by any requirement and is therefore left to the consumer; this story fixes the query, the semantics and the zero case, not the rendering.

## Dependencies

### Requires
- 004-record-and-export-audit-trail (the audit trail that holds the override authorisations).
- The immutable weighing records from unit 003 (the zone at confirmation).

### Enables
- A supervisor's view of batch weighing progress without visiting the station (BRD BR-22).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The period contains only weighings that were within tolerance | The report returns zero failures and zero overrides, with the period's batch progress still reported. |
| The period contains a failed print but no tolerance failure | A print failure is not a tolerance failure and does not appear in this report. |
| An override's subject weighing was later corrected by a new record | Both the original and the correcting record are visible through their reference, and the report does not merge or overwrite either. |
| The period spans a configuration change to a tolerance override rule | Weighings are reported against the zone recorded at their confirmation time, not against the configuration in force during the report period. |
| The period predates any recorded weighing | The report returns zero counts and no error. |
| Two overrides refer to the same subject | Both appear as separate rows, each with its own actor, reason and time. |

## Out of Scope

- A dashboard product or a BI-tool integration — CQ-07, and a new outbound flow rather than a new context.
- Changing any record to "correct" a reported figure.
- The supervisor's on-screen progress view — unit 007.
- The weighing-history search by batch, date, operator or dyestuff — BRD FR-18, unit 003.
- Deciding the tolerance model itself — A-07, Q-05.
