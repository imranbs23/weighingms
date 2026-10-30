---
id: 027-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: planned
stories:
  - 004-review-and-print-ticket
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 026-007-weighingms-ui
  - 019-006-ticket-printing
enables_bolts:
  - 028-007-weighingms-ui
requires_units:
  - 006-ticket-printing
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 3
---

# Bolt: 027-007-weighingms-ui

## Overview

Build the completion view, the ticket preview and the print controls, including the not-printed state a failed print produces.

## Objective

Build the completion view, the ticket preview and the print controls, including the not-printed state a failed print produces.

## Stories Included

- [ ] **004-review-and-print-ticket**: Review and print ticket - Priority: must

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. plan**: Plan - Pending → implementation-plan.md
- [ ] **2. implement**: Implement - Pending → source code + implementation-walkthrough.md
- [ ] **3. test**: Test - Pending → test-walkthrough.md

## Expected Outputs

- implementation-plan.md — the completion view and the print controls
- src/007-weighingms-ui — the completion view, the ticket preview and the print and reprint controls
- implementation-walkthrough.md

## Dependencies

### Requires

- **026-007-weighingms-ui** — Build the action row, the confirmation, the progression, the surplus panel and the escalation prompt.
- **019-006-ticket-printing** — Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself.

### Unit Dependencies (cross-unit)

- **006-ticket-printing**: must be complete before this bolt can start.

### Enables

- 028-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The client never composes the ticket — the template is configuration, so a template or language change needs no redeployment.
