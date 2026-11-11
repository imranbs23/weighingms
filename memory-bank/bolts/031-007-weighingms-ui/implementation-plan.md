---
stage: plan
bolt: 031-007-weighingms-ui
created: 2026-11-11T12:10:00Z
---

# Implementation Plan: Lot, Container and Tare in the Weigh View (Bolt 031)

## Objective

The workbook's Step 20 lists Lot, Container and Tare on the weigh view. The
live check (`evidence/STEP-20-weigh-screen.md`) found all three missing. The
prototype's header reads:

> DYE-4471 · Lot 2026-0387 · Container C-12 · Tare 214 g

Ours reads `DYE-4471`. This bolt closes that gap end to end: capture, show,
record, print.

## Baseline (what exists, what does not)

| | Exists | Missing |
|---|---|---|
| Lot capture | `POST /api/material-lot {componentId, code \| lotNumber}` (bolt 011): scan or keyed, attributed to the operator, append-only | No terminal step calls it |
| Container + tare | `POST /api/container {componentId, code \| containerId, scaleId}` (bolt 012): master tare (`C-09`, `C-11`, `C-12` = 214 g) or weigh the empty container (`D-03`, `D-05`) | No terminal step calls it |
| Header | Shows the lot and container **if** `GET /api/material-lot/:id` and `GET /api/container/:id` return one | Never shows the tare; and those reads return the latest capture **ever** for that component id, so a lot from an earlier batch would show as current |
| Record | `WeighingRecord` has `lotNumber` and `containerId` | The station's wiring passes `lotNumber: () => null, containerId: () => null` (`src/003-weighing-station/infrastructure/composition-root.ts:396-397, 485-486`), so **no record ever carries them** and the ticket says "No reading" |

## Deliverables

### Server (unit 003 composition only; units 002 and 008 unchanged)

1. **The record reads this session's lot and container.** The station's
   `ConfirmComponent` gets the active component's latest lot capture and
   container assignment from unit 002's repositories, **only if made at or
   after the session's `startedAt`**. An older capture is ignored.
2. **The session snapshot carries them.** `GET /api/session` adds, for the
   active component, `lot: {lotNumber, method} | null` and
   `container: {containerId, tareWeight, tareUnit, tareSource} | null`, under
   the same rule. The terminal reads the station's answer instead of unit
   002's unscoped reads.

### Terminal (unit 007)

3. **A "Prepare" panel** in the weigh view for the active component, before
   the pour:
   - **Lot**: one field, scan or type, then Capture → `POST /api/material-lot`.
     A scan sends `code`, typing sends `lotNumber`, the same scan-or-touch
     split as batch selection (ADR-030).
   - **Container**: one field → `POST /api/container` with the session's bound
     scale. A known container takes its master tare. `D-03`/`D-05` are weighed
     empty.
   - Refusals use the API's own reasons: empty lot, unknown container, tare
     refused, scale gave no reading. Each is shown as a locale message.
4. **The header** reads "code · Lot … · Container … · Tare … g" from the
   session snapshot, and shows only the parts that exist.
5. **The training bar** gets **Fill sample lot and container**, which keys
   the prototype's own values for the active component (e.g. `2026-0387`,
   `C-12`) through the same endpoints. It is training only, like Simulate
   dispense, and is hidden on a real device.
6. Completion and ticket need **no change**: they already render the
   record's `lotNumber` and `containerId`.

## Decision needed: required, or prompted?

| Option | Rule | Impact |
|---|---|---|
| **A · Prompted, optional (recommended)** | The Prepare panel is shown first and the header shows what is captured, but confirm does not wait for it. The record carries whatever was captured. | Matches the workbook (display), and keeps CQ-08 open (*"whether containers carry a lot barcode or the lot is keyed in"* is unresolved). No change to the gate; existing Step 24/29/30 runs keep working. |
| **B · Required, enforced by the station** | The gate refuses confirm until both are captured in this session (`LOT_REQUIRED`, `CONTAINER_REQUIRED`). | Strongest traceability (FR-5, AC-07), but it changes the gate, every test that confirms (41 call sites in 9 test files, plus all e2e flows) must capture first, and it decides CQ-08's question in code. |

## Technical Approach

- The session-scope rule lives in **one** place: a station helper
  `currentCapture(componentId, since)` used by both the record and the
  snapshot.
- The client computes nothing: no tare arithmetic and no lot validation of
  its own. It sends what the operator gave and renders what the station
  returns (the source tests' rules still hold).
- New strings go through `en.json` and the screen's key list. The
  regression test from bolt 030 stops a key going missing again.

## Acceptance Criteria

- [ ] Capturing lot `2026-0387` and container `C-12` for Remazol Blue shows
      "DYE-1180 · Lot 2026-0387 · Container C-12 · Tare 214.0 g"
- [ ] Confirming records `lotNumber 2026-0387` and `containerId C-12`; the
      completion detail and the ticket show them
- [ ] An empty lot is refused with the API's reason; nothing is recorded
- [ ] An unknown container (`X-99`) is refused; nothing is recorded
- [ ] A lot captured in an earlier session is not shown and not recorded
- [ ] Re-tare after a container keeps the container and its recorded tare
- [ ] (Option B only) confirm is refused until both are captured

## Tests (Stage 3)

- Integration: the record carries the session's lot and container; the
  earlier-session capture is ignored; the snapshot fields.
- UI: the Prepare panel (scan vs keyed request shape, refusals); the header
  format; the training fill hidden on a real device.
- E2E: a new Step 20 run captures the lot and container and confirms; the
  Step 20 evidence is re-captured with no element missing; Steps 24, 29 and
  30 re-run.

## Out of scope

- Dyestuff identity verification (story 002-002, a separate check).
- Changing unit 002's endpoints or its lot and container rules.
