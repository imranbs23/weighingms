---
stage: plan
bolt: 029-007-weighingms-ui
created: 2026-11-10T14:41:17Z
---

# Implementation Plan: The Working Operator Terminal (Bolt 029)

## Objective

Bolts 024–028 built every screen, and every screen passes its own tests,
but the workbook's Step 28 validation (2026-11-10) drove the **running**
application and found that it cannot be operated end to end: selecting a
batch leaves the operator on the queue, the weigh view cannot start, there
is no way to put weight on a dummy scale, and nothing completes the batch.

This bolt wires the views into **one workflow** and brings the terminal's
presentation up to the prototype. When it is done, an operator can, through
the UI alone:

sign in → select B-24187 → weigh five components (3 kg and 32 kg scales) →
confirm each → complete the batch (OrgaTEX write-back) → print the ticket →
next batch.

## Baseline

The working tree holds **staged, uncommitted** changes from the previous
session (session resume on restart, configurable CORS origins, the
completion route in `App`, the Dummy OrgaTEX control). With them the suite is
green: typecheck clean, 1875/1875 tests. This bolt builds on that baseline
and commits it together with its own work.

## Deliverables

### Workflow blockers (from `validation.md` B1–B7)

1. **B1 — selection opens the weigh view.** After `POST /api/selection`
   succeeds, the app loads the batch's recipe and moves to the weigh view.
   The screen decision in `App` is re-evaluated whenever the workflow
   changes (selection, confirmation, completion, next batch), not only on
   sign-in. The decision stays the **API's**: the client asks for the
   session and the selection; it does not keep its own idea of the screen.
2. **B2 — the weigh view starts without a session.** The recipe rail is
   built from `GET /api/recipe/:batchId` (the selected batch), with each
   component's state merged in from the session once one exists. The first
   PENDING component is selected automatically (`POST /api/session/select`)
   so the operator lands on a component, as in the prototype.
3. **B3 — the training dispense controls.** A clearly labelled
   **Training** bar on the weigh view with **Simulate dispense** and
   **Simulate overshoot**, calling the existing
   `POST /api/scales/:scaleId/dispense` (landing `IN_TOLERANCE` /
   `OVER_TOLERANCE`). The bar shows only when the scale is a dummy
   (`GET /api/scales` reports the source); a real scale never shows it. It
   replaces the e2e fixture's direct API call as the way to drive the scale.
4. **B4 — the action row.** **Re-tare** calls `POST /api/scales/:id/tare`.
   **Quit** leaves the weigh view for the queue without confirming,
   and the component stays un-confirmed. **Supervisor override** opens the
   existing escalation panel (`POST /api/escalation`). F1 confirm, F2
   re-tare, F4 quit dispatch the **same** handlers as the buttons.
5. **B5 — completion.** When the last component is confirmed, the weigh
   view calls `POST /api/batch/:batchId/complete` (the station's write-back
   to the Dummy OrgaTEX) and the app moves to the completion view, which
   shows "Written to OrgaTEX · CONFIRMED" from the summary.
6. **B6 — Next batch.** The completion view gets **Next batch** (F3), which
   returns to the queue with the queue reloaded.
7. **B7 — idle scales READY.** Find why an idle dummy scale reports
   `DISCONNECTED · not responding`. The likely cause is that a dummy device
   produces readings only while a session subscribes to it, so the link
   watchdog times out at idle. The fix is in unit `004`: a registered device's
   link is kept alive at boot, so an idle, connected scale reads `READY`, as
   a real indicator would. The disconnect detection itself (2 s) is
   unchanged.

### Presentation gaps (V1–V5)

8. **V1 — terminal layout.** A topbar (WeighingMS · station · batch ·
   order · machine · operator), the two-column weigh layout (rail left,
   work area right), the large readout, the prototype's colour tokens, all in
   `styles/tokens.css` plus one layout stylesheet. No CSS framework is added.
9. **V2 — tolerance band.** The bar is scaled to the bound scale's capacity
   (from `GET /api/scales`), draws the OK band and the target line, and has
   the caption "TOLERANCE ±x (lo – hi)" and the capacity. The status line
   gains "N REMAINING".
10. **V3 — function keys** shown on the buttons (F1/F2/F3/F4), per item 4.
11. **V4 — ticket barcode.** See *Decision needed* below.
12. **V5 — status strip.** The clock and the locale (EN) are added on the client.
    Scanner and printer entries need two small read endpoints:
    `GET /api/scanner/status` (unit `002`) and `GET /api/printer/status`
    (unit `006`), each reporting the dummy device's state.

## Dependencies

- **Unit 001**: `POST /api/selection`, `GET /api/batch-queue` (existing)
- **Unit 002**: `GET /api/recipe/:batchId`, lot and container (existing); **new** scanner status
- **Unit 003**: `/api/session/*`, `/api/escalation`, `POST /api/batch/:id/complete`, summary (existing)
- **Unit 004**: `/api/scales`, `/dispense`, `/tare` (existing); **fix** for idle link (B7)
- **Unit 006**: tickets and print jobs (existing); **new** printer status
- No new npm dependencies.

## Technical Approach

- A small **workflow store** (Zustand, like the other stores) holds only
  *which view* and *which batch*. Every transition is triggered by an API
  success and re-reads the API's state. The rule that "the client has no
  rules" holds: tolerance, zone, progression and completion stay server-side.
- Keyboard handling is one `useFunctionKeys` hook mapping F1–F4 to the
  handlers the buttons already call.
- The dummy-only training bar is gated on the scale's reported source,
  so it cannot appear against a real device.
- Existing `data-testid`s are kept, and new controls get test ids, so that
  Step 29's Playwright suite drives the UI and not the API.

## Acceptance Criteria

- [ ] Selecting B-24187 (touch or scan) opens the weigh view with five components in the rail and the first one active
- [ ] Simulate dispense brings the weight into tolerance; OK · Confirm becomes enabled; confirming advances to the next component
- [ ] Yellow RGB binds the 3 kg scale and Sodium Sulphate the 32 kg scale, and the badge and units change
- [ ] Simulate overshoot shows OVER, confirm is disabled and the surplus panel appears
- [ ] Re-tare zeroes the reading; Quit returns to the queue without a record; F1/F2/F4 do what the buttons do
- [ ] Confirming the fifth component completes the batch, the Dummy OrgaTEX holds the consumption record, and the completion view shows CONFIRMED
- [ ] Print ticket produces the ticket preview; Next batch returns to the queue
- [ ] Idle scales show READY; the strip shows scanner, printer, OrgaTEX, the locale and the clock
- [ ] The weigh view's layout matches the prototype's structure (side-by-side screenshots in Step 28)
- [ ] Typecheck clean; the existing 1875 tests pass; new tests cover each item above
- [ ] Step 28 re-run: `validation.md` updated with app screenshots for all three screens

## Decision needed (V4 — barcode)

The prototype's ticket shows a barcode, but the symbology and label format
are an **open question in the Product Brief** (Q-11 / Q-18). Options:

1. **Render a Code 128 barcode of the batch id** in the preview, marked
   "training label". This matches the prototype visually, and Code 128 is
   a common default.
2. **Keep it out** and show the batch id in large text only, deferring
   the symbology to the printer contract.

**Decision (2026-11-10, human checkpoint): option 1.**
format as unconfirmed.
