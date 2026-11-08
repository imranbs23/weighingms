---
id: 002-print-ticket-and-track-job
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 002-print-ticket-and-track-job

## User Story

**As a** weighing operator
**I want** to print the ticket and see whether the print actually succeeded
**So that** I know the paperwork exists before the container leaves the station

## Acceptance Criteria

- [ ] **Given** a generated ticket and an available printer, **When** a print is requested, **Then** a `PrintJob` is created in state `QUEUED`, the job is driven through `PRINTING` to `DONE`, and the job's state is retrievable by its identifier (BRD FR-17, BRD FR-19).
- [ ] **Given** a print job, **When** it is read, **Then** it carries the ticket identifier, the state, the attempted time, the completed time when it completed, and — on failure — the error (BRD FR-19).
- [ ] **Given** a printer that is unavailable or a print attempt that fails, **When** the failure is recorded, **Then** the print job's state is `FAILED` with a visible error, **and the confirmed weighing record still exists and remains queryable** (BRD FR-19, B-7).
- [ ] **Given** a print job that failed, **When** the ticket is printed again later, **Then** the ticket prints successfully without the weighing having been re-entered, re-weighed or re-confirmed (B-7, BRD FR-19).
- [ ] **Given** a print job that completed, **When** it is read, **Then** `isReprint` is `false` and the job is distinguishable from a reprint (BRD FR-28).
- [ ] **Given** a print job exists, **When** the system loses power immediately afterwards, **Then** the job's recorded state survives, including a job left in `QUEUED` or `PRINTING` (NFR-3, BRD NFR-05).

## Technical Notes

- **B-7 is the governing failure boundary of this unit: a printer failure must never cost a weighing.** Recording a weighing and printing its ticket are therefore two operations with two independent outcomes. The implementation must never wrap the weighing write and the print call in a single transaction, and the failed-print path must not roll back, suppress or hide the confirmed weighing.
- The print adapter is the only component that talks to the printer. In this build that is the Dummy Printer training contract (`POST /api/tickets`); no real printer contract is invented (BRD IR-16).
- `PrintJob` rows are append-only in practice: each attempt is a new row in the `QUEUED → PRINTING → DONE|FAILED` lifecycle, and no attempt is edited after it settles. Story 003 adds the reprint variant.
- Job state must be retrievable while it is in flight, so the UI can show "printing" rather than a dead button.
- Power-loss durability: the state transition is committed before the printer call is made, so a crash mid-print leaves a `PRINTING` job that can be reconciled rather than no trace at all (NFR-3, BRD NFR-05).
- Retention: print jobs are retained ≥ 5 years (DR-01).

## Dependencies

### Requires
- 001-generate-weighing-ticket (the ticket to print).
- The printer adapter boundary.

### Enables
- 003-reprint-ticket-with-reason
- 004-record-and-export-audit-trail
- Unit 007 story 004 (review and print the ticket at batch completion).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The printer is out of paper | Job ends `FAILED` with the error visible; the weighing is recorded; the ticket is offered for reprint. |
| The printer responds slowly and the operator retries | Each attempt is its own job row; a duplicate attempt does not duplicate the ticket or the weighing. |
| Power is lost while the job is `PRINTING` | The job row remains `PRINTING` and is reconcilable; the weighing record is unaffected. |
| The ticket is printed twice by accident (double-tap) | Two print jobs exist; the second is still a first print unless a reprint reason was supplied — the reprint marking is a property of the request, not of the count. |
| The ticket is deleted or the template is removed after printing | The printed artefact is unaffected; the ticket record and its lines are retained (DR-01). |

## Out of Scope

- The reprint marking and its reason — story 003.
- The ticket content and layout — story 001 and configuration.
- Any decision about whether a weighing is acceptable — unit 003.
- The physical printer model, paper size or print resolution — not settled (Q-11).
