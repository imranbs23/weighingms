---
id: 032-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 004-gate-confirmation-on-zone
created: 2026-11-11T12:59:34Z
started: 2026-11-11T12:59:34Z
completed: 2026-11-11T13:57:56Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-11T13:10:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-11T13:18:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-11T13:25:00Z
    artifact: adr-048-the-record-snapshots-its-tare.md
  - name: implement
    completed: 2026-11-11T13:40:00Z
    artifact: source code
  - name: test
    completed: 2026-11-11T13:35:00Z
    artifact: ddd-03-test-report.md
requires_bolts:
  - 012-002-recipe-material-management
  - 031-007-weighingms-ui
enables_bolts: []
requires_units:
  - 002-recipe-material-management
blocks: false
complexity:
  avg_complexity: 1
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 032-003-weighing-station

## Overview

Record the tare on the weighing record. Appended during construction
(`bolt-replan` → append) after the workbook's Step 25 check found that a
confirmed weighing records actual weight, operator, component, lot,
container, scale and timestamp, but **not the tare**: the tare lives only on
the container assignment, although ADR-035 says the assignment keeps it
"because the weighing record carries it".

## Objective

A confirmed weighing carries the tare that applied to it (value, unit and
source), snapshotted at confirmation from this session's container
assignment, so a past weighing can be reconstructed from its own record
(BRD BR-14) and all eight of the workbook's fields are on one row.

## Stories Included

- [x] **004-gate-confirmation-on-zone**: the written record also carries the tare, with the container (workbook Step 25, ADR-035)

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete (APPROVE MODEL) → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete (APPROVE DESIGN) → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis - Complete (APPROVE ADR) → adr-048-the-record-snapshots-its-tare.md
- [x] **4. implement**: Implement - Complete (APPROVE IMPLEMENTATION) → source code
- [x] **5. test**: Test - Complete (APPROVE TESTS) → ddd-03-test-report.md

## Dependencies

### Requires

- **012-002-recipe-material-management** — the container assignment and its tare
- **031-007-weighingms-ui** — this session's captures (`capturesFor`)

## Success Criteria

- [x] A confirmed weighing with a container carries its tare (value, unit, source)
- [x] Without a container, the tare is absent (null), never invented
- [x] Existing records stay valid; the table stays append-only
- [x] Tests passing; Steps 24, 29 and 30 still pass

## Notes

Source: workbook Step 25; ADR-035.
