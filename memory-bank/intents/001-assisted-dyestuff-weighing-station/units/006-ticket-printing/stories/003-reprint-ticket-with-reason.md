---
id: 003-reprint-ticket-with-reason
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 003-reprint-ticket-with-reason

## User Story

**As a** dyehouse supervisor
**I want** to reprint a ticket, with the reprint visibly marked and a reason recorded
**So that** a second copy can never be mistaken for the original and the reason for it is traceable

## Acceptance Criteria

- [ ] **Given** an existing ticket, **When** a reprint is requested with a non-empty reason, **Then** a new print job is created with `isReprint` set to `true` and `reprintOf` pointing at the original ticket (BRD FR-17, BRD FR-28).
- [ ] **Given** a reprint job, **When** it is read, **Then** it carries the reason for the reprint, the reprinting actor and the time, and it is distinguishable from a first print in both the stored record and the rendered output (BRD FR-17, BRD FR-28, BRD FR-21).
- [ ] **Given** a reprint request with an empty or absent reason, **When** it is submitted, **Then** the request is refused and no print job is created (BRD FR-21).
- [ ] **Given** a reprint of a ticket, **When** the reprint job is recorded, **Then** an append-only audit entry is written carrying the actor, the actor's role, the subject (the ticket and the original print job) and the reason (BRD FR-21, BRD FR-36).
- [ ] **Given** a reprint has been produced, **When** the original ticket's weighing records are read, **Then** they are unchanged — a reprint never creates, alters or removes a weighing record (BRD FR-18, BRD DR-02, B-7).

## Technical Notes

- The reprint is a **new print job against the existing ticket**, never a re-generation of the ticket. Regenerating would produce a new ticket identity and lose the link to the original print.
- The marking must appear in two places: on the stored `PrintJob` (`isReprint`, `reprintOf`, `reason`) and on the rendered artefact, so a paper copy in the dyehouse is self-identifying. The rendered marking's wording comes from the locale bundle, not from a literal in code.
- The reason is **mandatory**. A reprint without one is refused at the request boundary, not merely recorded as blank.
- The audit entry is written by the same append-only mechanism as every other privileged action, so the reason is queryable from the audit trail and from the export (BRD FR-21).
- A reprint is a privileged action but does **not** require supervisor authentication in this build — the BRD's supervisor-authentication requirement (BRD FR-35) names tolerance override, manual scale reselection and calibration bypass. What a reprint requires is attribution and a reason. The `actorRole` on the audit entry therefore records whoever pressed reprint, which may be the operator.
- The reprint does not re-weigh, re-confirm or re-post anything to OrgaTEX.

## Dependencies

### Requires
- 001-generate-weighing-ticket (the ticket being reprinted).
- 002-print-ticket-and-track-job (the print job lifecycle).
- 004-record-and-export-audit-trail (the append-only audit mechanism).

### Enables
- Unit 007 story 004 (the reprint control on the completion view).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| A ticket is reprinted three times | Three reprint jobs, each with `isReprint` true, each with its own reason, actor and time, all pointing at the same original ticket. |
| A reprint is requested for a ticket whose original print failed | The reprint is still marked `isReprint` because it is not the first print job for that ticket; the original failed job remains in the trail. |
| The reason contains non-Latin characters or is long | The reason is stored verbatim; length is bounded by validation and the bound is not enforced by truncating the stored value. |
| The reprint happens after the locale changed | The reason is stored as entered; the reprint marking on the artefact uses the locale in force at reprint time. |
| The operator signing out between requesting and completing a reprint | The job is attributed to the actor who requested it, by their captured identity at request time. |

## Out of Scope

- The ticket content and layout — story 001 and configuration.
- Supervisor authentication for privileged actions — unit 008 story 002.
- Deciding whether a reprint requires supervisor approval — not a requirement in the BRD's set (BRD FR-35).
