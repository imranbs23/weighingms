---
id: 019-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-generate-weighing-ticket
  - 002-print-ticket-and-track-job
created: 2026-10-30T09:00:00Z
started: 2026-11-06T07:20:00Z
completed: 2026-11-06T08:31:07Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T07:40:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T08:00:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T08:15:00Z
    artifact: adr-042-the-print-path-cannot-cost-a-weighing.md
  - name: implement
    completed: 2026-11-06T08:45:00Z
    artifact: source code
requires_bolts:
  - 018-003-weighing-station
enables_bolts:
  - 020-006-ticket-printing
  - 022-006-ticket-printing
  - 027-007-weighingms-ui
requires_units:
  - 003-weighing-station
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 019-006-ticket-printing

## Overview

Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself.

## Objective

Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself.

## Stories Included

- [ ] **001-generate-weighing-ticket**: Generate weighing ticket - Priority: must
- [ ] **002-print-ticket-and-track-job**: Print ticket and track job - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-042
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — Ticket, TicketLine and PrintJob
- ddd-02-technical-design.md — the template contract and the printer adapter
- src/006-ticket-printing/domain — the ticket and print-job model
- src/006-ticket-printing/infrastructure — the template renderer and the dummy printer
- src/006-ticket-printing/presentation — the ticket and print endpoints

## Dependencies

### Requires

- **018-003-weighing-station** — Close the batch at the last component and produce the summary the ticket is rendered from, with the consumption posting handed to the adapter.

### Unit Dependencies (cross-unit)

- **003-weighing-station**: must be complete before this bolt can start.

### Enables

- 020-006-ticket-printing
- 022-006-ticket-printing
- 027-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

B-7 — a printer failure must not cost a weighing. Recording and printing are separate operations with separate outcomes, and a failed print leaves the weighing recorded and the job retryable.
