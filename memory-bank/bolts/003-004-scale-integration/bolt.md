---
id: 003-004-scale-integration
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-receive-live-weight-stream
  - 002-detect-disconnection-and-block-weighing
created: 2026-10-30T09:00:00Z
started: 2026-10-30T20:50:00Z
completed: 2026-10-31T00:20:00Z
current_stage: complete
stages_completed:
  - name: model
    completed: 2026-10-30T20:50:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-10-30T23:20:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-10-30T23:45:00Z
    artifact: adr-008-weight-value-crosses-the-wire-as-a-decimal-string.md, adr-009-weight-readings-are-never-persisted.md, adr-010-zeroed-does-not-block-weighing.md, adr-011-link-state-is-separate-from-device-status.md, adr-012-the-disconnection-watchdog-is-scheduled-not-polled.md, adr-013-scale-telemetry-endpoints-are-not-session-authenticated.md
  - name: implement
    completed: 2026-10-31T00:05:00Z
    artifact: src/004-scale-integration/domain, src/004-scale-integration/infrastructure, src/004-scale-integration/presentation
  - name: test
    completed: 2026-10-31T00:20:00Z
    artifact: ddd-03-test-report.md

# Bolt Dependencies (for execution ordering)
requires_bolts: []
enables_bolts:
  - 004-004-scale-integration
  - 028-007-weighingms-ui
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 3
  testing_scope: 2
---

# Bolt: 003-004-scale-integration

## Overview

Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz and disconnect detection within 2 s that blocks weighing rather than letting a stale reading pass for a live one.

## Objective

Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz and disconnect detection within 2 s that blocks weighing rather than letting a stale reading pass for a live one.

## Stories Included

- [ ] **001-receive-live-weight-stream**: Receive live weight stream - Priority: must
- [ ] **002-detect-disconnection-and-block-weighing**: Detect disconnection and block weighing - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-008…adr-013
- [ ] **4. implement**: Implement - In progress → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — ScaleReading, ScaleStatus and the LinkState value object
- ddd-02-technical-design.md — the SSE contract and the staleness rule
- src/004-scale-integration/domain — the reading and status model
- src/004-scale-integration/infrastructure — the dummy scale adapter
- src/004-scale-integration/presentation — the weight SSE endpoint and status endpoint

## Dependencies

### Requires

- None (first bolt)

### Unit Dependencies (cross-unit)

- None

### Enables

- 004-004-scale-integration
- 028-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

B-5 — a scale that returns only a stabilised value rather than a stream is the single largest design risk in the build. The dummy scale streams, and the seam is where a real scale would be substituted.
