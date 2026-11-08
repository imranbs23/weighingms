---
id: 003-evaluate-tolerance-zone
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 003-evaluate-tolerance-zone

## User Story

**As a** dyehouse operator
**I want** the weight to be judged against the target for me and shown as under, near, OK or over
**So that** I always know whether what is on the scale is acceptable

## Acceptance Criteria

- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `95.0000 g` (exactly `target + tolerance`), **Then** the zone is `OK` — a reading exactly equal to `target + tolerance` is **not** `OVER` (FR-9, `C-05`, C-07).
- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `94.5000 g` (exactly `target − tolerance`), **Then** the zone is `OK` (FR-9, `C-05`, C-07).
- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `84.6000 g` (exactly `target × 0.9`), **Then** the zone is `NEAR` (FR-9, `C-05`, C-07).
- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `94.5001 g`, **Then** the zone is `OVER` (FR-9, `C-05`, C-07).
- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `84.5999 g`, **Then** the zone is `UNDER` (FR-9, `C-05`, C-07).
- [ ] **Given** a reading is received, **When** the zone is computed, **Then** the zone is computed by the domain and returned by the service to every consumer, and no consumer — in particular no screen — computes it independently (FR-9, BRD FR-16, BRD FR-17).

## Technical Notes

- **The zone is computed here, in the domain, and only here.** The UI receives the zone; it never derives it. The same computed zone feeds the status line, the live-weight cell and the progress bar, so they cannot disagree (FR-9, `C-05`).
- The four-zone rule is evaluated in this exact order, on **every** reading, against the **active** component's target and tolerance:
  1. `OVER` if `value > target + tolerance`
  2. `OK` if `value >= target − tolerance`
  3. `NEAR` if `value >= target × 0.9`
  4. `UNDER` otherwise
- Boundary semantics are exclusive/inclusive as written: `OVER` is strict `>`, `OK` is inclusive `>=` at both bounds, `NEAR` is inclusive `>=` at `target × 0.9`. A reading exactly at `target + tolerance` is `OK`; exactly at `target − tolerance` is `OK`; exactly at `target × 0.9` is `NEAR`.
- `target × 0.9` is computed in **fixed-point decimal**, not by multiplying a float. With 4 dp storage, `94.0000 × 0.9 = 84.6000` exactly. Multiplication by `0.9` must use decimal arithmetic with a defined rounding (half-up, at the storage precision) so the boundary is deterministic.
- This is modelled as a **`ToleranceZone` value object inside this unit** — a pure computation with no state, no persistence and no external contract. It is not extracted into a separate unit, because doing so would put a network hop between the scale and the confirmation button (see the unit brief's §Notes).
- The tolerance model itself (percentage with an absolute floor, originating in OrgaTEX) comes from unit `002-recipe-material-management`; the exact model is still open (`Q-05`, `A-07`). This story consumes the resolved target and tolerance and does not re-derive them.
- The zone is retained on the weighing record as `zoneAtConfirm` — the zone at the moment of confirmation, snapshotted so a later tolerance revision cannot rewrite history (BRD FR-25, BRD BR-14).
- The unit brief requires an **exhaustive boundary test suite** at every threshold: exactly `target − tolerance`, exactly `target × 0.9`, exactly `target + tolerance`, and one ULP either side of each.
- All arithmetic is fixed-point decimal; no float appears in the comparison path (BRD NFR-16, `C-11`).

## Dependencies

### Requires
- 002-consume-live-weight-stream (the reading that is evaluated)

### Enables
- 004-gate-confirmation-on-zone (gating consumes the zone)
- 005-detect-overdose-and-calculate-surplus (the `OVER` zone triggers over-dose detection)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Reading exactly `target + tolerance` | `OK`, not `OVER` — the `OVER` bound is strict |
| Reading exactly `target − tolerance` | `OK` — the `OK` bound is inclusive |
| Reading exactly `target × 0.9` | `NEAR`, not `UNDER` |
| Reading one unit below `target × 0.9` | `UNDER` |
| Target is zero | `target × 0.9` is zero; any positive reading is `OVER`; a zero reading is `OK` |
| Tolerance is zero | `OK` requires `value == target` exactly |
| The active component changes mid-stream | The zone is recomputed against the **new** component's target and tolerance on the next reading; the stale zone is discarded |
| No component is active | No zone is produced; the session exposes no zone |

## Out of Scope

- Where the target and tolerance come from → `002-recipe-material-management` (`Q-05`, `A-07`).
- The status-line wording and the zone colouring → `007-weighingms-ui`.
- Confirmation gating → story 004.
- Over-dose detection and surplus calculation → story 005.
