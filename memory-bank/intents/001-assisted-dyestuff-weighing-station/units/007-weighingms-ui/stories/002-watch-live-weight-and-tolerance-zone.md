---
id: 002-watch-live-weight-and-tolerance-zone
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 002-watch-live-weight-and-tolerance-zone

## User Story

**As a** weighing operator
**I want** to watch the live weight, the tolerance band and a plain statement of where I stand
**So that** I know at a glance whether I am finished, nearly finished, or over

## Acceptance Criteria

- [ ] **Given** a weighing session is active, **When** the weigh view renders, **Then** the recipe rail shows each component with its state (`PENDING` / `ACTIVE` / `DONE`), the live readout shows the current weight, the still-to-weigh quantity and the target quantity each with its unit, and the tolerance band and scale capacity are shown on the indicator (FR-3, FR-8).
- [ ] **Given** the API reports a zone, **When** the view renders, **Then** the status line text and the readout colour are those the API reports for that zone, and the client performs **no zone computation of its own** (FR-9, BRD FR-10).
- [ ] **Given** the scale is producing readings, **When** the weight is displayed, **Then** the displayed value lags the scale by no more than 200 ms, and the readout is legible at 1.5 m (NFR-1, AC-03, NFR-4).
- [ ] **Given** a weight in grams and a weight in kilograms, **When** each is displayed, **Then** grams are shown to 1 decimal place and kilograms to 3 decimal places, formatted from a fixed-point decimal and never parsed as a float (NFR-2, BRD NFR-16).
- [ ] **Given** the scale stream stops without an explicit error, **When** no reading has arrived within the staleness threshold, **Then** the readout shows **no value** — never `0.0` — and the stream's age is shown (BRD FR-19, NFR-1).
- [ ] **Given** any element of the weigh view, **When** the operator-facing strings are inspected, **Then** **no user-visible literal string is written in a component** — every string comes from the locale bundle (BRD FR-22, BRD NFR-11).

## Technical Notes

- **The zone is received, never computed by the client.** The zone, the remaining quantity and the tolerance band all arrive in the session snapshot. Two classifications of the same reading in two places is the failure mode this avoids, and it is also why the confirm button's disabled state can be trusted (FR-9, BRD FR-10).
- **A silent scale shows no value — never `0.0`.** This is the client-side half of "no failure may produce a silently wrong number" (B-1). The readout renders an explicit empty state, and the confirm action is disabled with a stated reason. A `0.0` fallback would be indistinguishable from a genuinely empty scale and would be the most dangerous thing the client could render.
- The displayed weight **lags the scale by ≤ 200 ms** (NFR-1, AC-03): the client renders the newest reading it has and exposes its age, so the operator can see when the stream falls behind.
- Decimals: 1 dp for grams, 3 dp for kilograms, per the prototype's `dp()` rule. Quantities are **formatted**, never parsed as a float — the client receives fixed-point decimal values (NFR-2, BRD NFR-16).
- The tolerance band bar reproduces the prototype exactly: the bar is scaled against the **scale's maximum capacity**, and the band is `(target ± tolerance) / max`. The band is always visible whether or not the zone is `ok` (FR-8, FR-9).
- The progress indicator is accessible: `role="progressbar"` with `aria-valuenow` (FR-8).
- The indicator, the live-weight cell and the status line share a `data-zone` attribute, so the zone is visibly consistent across the three elements (FR-9).
- The recipe rail is the component selector, but its states come from the API. A `DONE` component is terminal and cannot be selected (C-08).
- The scale's stability flag distinguishes settling from settled, and the readout reflects it (BRD FR-19, BRD IR-11).

## Dependencies

### Requires
- Unit 003's session snapshot and zone computation.
- Unit 004's live weight stream (SSE) and scale status.
- The locale bundle endpoint from unit 006 (story 005).

### Enables
- 003-confirm-weighing-and-advance
- 005-show-peripheral-degraded-states

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The scale disconnects mid-weighing | The readout shows no value, the confirmation is blocked, and the reason is stated within 2 s (BRD FR-19, BRD IR-13). |
| Readings arrive out of order | The client renders the newest reading by its sequence or timestamp, not the last one received. |
| The target is in kilograms and the scale reads in grams | The unit conversion is performed server-side; the client formats and displays the unit the API reports and does not convert. |
| The weight sits exactly on the tolerance boundary | The zone shown is the one the API reports; the client applies no boundary rule of its own. |
| The stream lags by more than 200 ms | The reading is still shown, and its age is visible so the operator can judge whether to trust it. |
| The scale reports an out-of-calibration state | Weighing is blocked and the reason is stated; the readout does not show a value implying the scale is usable (FR-7, AC-14). |

## Out of Scope

- Zone computation and tolerance rules — unit 003 (FR-9).
- The weight stream's origin — unit 004 (FR-8).
- The confirm action's behaviour — story 003.
- The recipe's content and ordering — unit 002 (FR-3).
- Physical scale calibration — FR-7, unit 003.
