---
stage: implement
bolt: 029-007-weighingms-ui
created: 2026-11-10T15:20:00Z
---

## Implementation Walkthrough: weighingms-ui

### Summary

The operator terminal can now be operated end to end through its UI alone:
sign in, select B-24187, weigh all five components on the dummy 3 kg and
32 kg scales, confirm each, let the station complete the batch (OrgaTEX
write-back `CONFIRMED`), print the ticket, and go to the next batch. The
three views were rebuilt in the supplied prototype's layout and palette.
Verified by driving the running app with Playwright
(`playwright/step28-capture.spec.ts`).

### Structure Overview

The client has one new store, the workflow store. It holds only which view
is shown and for which batch, and it moves only after an API success. Every
rule stays server-side. Starting a batch and binding the next component's
scale were added to the weighing station (unit 003), so the client never
decides progression (FR-14). The training controls drive the dummy scale
through the station, which reads the target and the band from the recipe.
A terminal stylesheet carries the prototype's layout; the touch-target and
label-size floors stay inline where the tests measure them.

### Completed Work

**Workflow blockers (B1–B7)**

- [x] `src/007-weighingms-ui/state/workflow-store.ts` - the view and the batch; opens a batch (recipe, then session start), completes it, quits, next batch; resumes the session's state on sign-in
- [x] `src/007-weighingms-ui/state/queue-store.ts` - an accepted selection opens the batch it named (B1)
- [x] `src/007-weighingms-ui/app/App.tsx` - the terminal frame: top bar, the workflow's view, status strip (re-read every 3 s)
- [x] `src/003-weighing-station/infrastructure/composition-root.ts` - `startSession` (first component in MES order, or continue the active one, and bind its scale); `trainingDispense`; the platform is cleared when a scale is bound to a new component (B2, B3)
- [x] `src/003-weighing-station/presentation/controllers/session-controller.ts` - `POST /api/session/start`, `POST /api/session/training/dispense`; after a confirm that advances, the station binds the next component's scale (the 3 kg → 32 kg switch)
- [x] `src/003-weighing-station/application/use-cases/select-component.ts` - a completed batch's or another batch's session is never continued; a new one starts
- [x] `src/003-weighing-station/infrastructure/persistence/sqlite-weighing-session-repository.ts` - the current session is the most recently started one (it was the first row ever written, so a second batch could never become current)
- [x] `src/003-weighing-station/domain/ports/weighing-station-ports.ts`, `infrastructure/adapters/scale-stream-adapter.ts` - the optional training hooks: clear the platform, dispense (converted into the device's unit by unit 004's converter)
- [x] `src/004-scale-integration/infrastructure/adapters/dummy-scale-adapter.ts` - the dispense target is NET (the tare is added to the ramp's gross target); `grossWeight`; `clearForNextComponent`
- [x] `src/004-scale-integration/infrastructure/composition-root.ts` - `keepDevicesAlive`: every dummy device streams from boot, so an idle connected scale is READY, not timed out to DISCONNECTED (B7)
- [x] `src/004-scale-integration/presentation/controllers/scale-controller.ts` - `source: DUMMY|DEVICE` on `GET /api/scales`; `POST /api/scales/:id/re-tare` tares against the device's own gross reading (B4)
- [x] `src/api/server.ts` - starts the device keep-alive before the session resume
- [x] `src/007-weighingms-ui/state/status-store.ts` - a scale is healthy in any status that can weigh (`CONNECTED`, `ZEROED`, `BUSY`), not only `READY`: the second half of B7
- [x] `src/007-weighingms-ui/screens/weigh/WeighScreen.tsx` - the rail from the recipe with the session's states; the training bar (dummy only); Re-tare; Quit returns to the queue; Supervisor override raises the escalation; the surplus proposal is requested once the over-tolerance reading comes to rest; a confirm the station reports as `batchComplete` completes the batch (B2–B5)
- [x] `src/007-weighingms-ui/screens/weigh/ActionRow.tsx` - OK · Confirm F1, Re-tare F2, Quit F4, Supervisor override; `useFunctionKeys` binds the keys to the same handlers as the buttons (B4, V3)
- [x] `src/007-weighingms-ui/screens/completion/CompletionScreen.tsx`, `components.tsx` - the prototype's layout; Next batch F3; Print F1; the per-component detail kept (B6)
- [x] `src/007-weighingms-ui/api/endpoints.ts` - the client calls for start, training dispense, re-tare, complete, escalation, scanner and printer status

**Peripheral status (V5)**

- [x] `src/001-batch-management/presentation/controllers/scanner-controller.ts` - `GET /api/scanner/status`
- [x] `src/006-ticket-printing/presentation/controllers/printer-controller.ts` - `GET /api/printer/status`
- [x] `src/001-batch-management/infrastructure/adapters/dummy-batch-scanner.ts`, `src/006-ticket-printing/infrastructure/adapters/dummy-printer-adapter.ts` - expose their state
- [x] `src/api/app.ts` - mounts both
- [x] `src/007-weighingms-ui/screens/status/StatusStrip.tsx` - the horizontal strip: scales by label, scanner, printer, OrgaTEX, un-synchronised count, locale, clock

**Presentation (V1–V4)**

- [x] `src/007-weighingms-ui/styles/terminal.css` - the prototype's HMI layout and palette (top bar, rail, readout, bar, keys, ticket, strip)
- [x] `src/007-weighingms-ui/screens/chrome/TopBar.tsx` - brand, station, the batch · order · machine crumb
- [x] `src/007-weighingms-ui/screens/weigh/components.tsx` - rail entries with swatch, name, code, target and state; the three-cell readout; the bar with fill, OK band and target line, and the caption "TOLERANCE ±x (lo – hi)"; the status line with "N REMAINING" (V2)
- [x] `src/007-weighingms-ui/format/code128.ts` - Code 128-B encoder for the ticket's barcode (V4, decision option 1)
- [x] `src/007-weighingms-ui/format/quantity.ts` - fixed-point helpers for the bar's display range and the ±half-width
- [x] `src/007-weighingms-ui/screens/batch-queue/*`, `identity/*` - the scan prompt with the beam, the queue table, the workflow's refusal; the operator chip; the sign-in panel
- [x] `src/006-ticket-printing/locales/en.json` - 50 new operator-facing strings (the client holds none)

### Key Decisions

- **Progression stays on the server**: the first component, and the next one after a confirm, are bound by the station (`startSession`), so the existing FR-14 source rule (no client-side "next PENDING") still holds.
- **The client sends no quantity**: the training dispense sends only the landing; re-tare sends nothing. The target, band, unit conversion and gross weight are all server-side, in fixed-point.
- **The training controls are gated on `source: DUMMY`**: they cannot appear against a real indicator.
- **Overshoot is shown, not resolved**: OVER disables confirm, the surplus proposal is shown and the override can be raised. The recovery is Re-tare and pour again. The business rule itself is the workbook's Step 24 human decision and is not invented here.

### Deviations from Plan

- **The bar is scaled to a display range of 4/3 × target**, as the prototype does (its 125 g axis for a 94 g target), rather than to the scale's capacity: against 3000 g a 94 g fill would be 3 % of the bar. The capacity stays in the scale badge.
- **The scanner endpoint is in unit 001** (where the scanner adapter lives), not 002 as the plan said.
- **Two further server defects were found and fixed** while wiring the flow: the session repository's `current()` (no ordering) and `SelectComponent` continuing a completed session. Without both fixes, "Next batch" could not start a second batch.
- **The weigh-head shows no lot or container** for B-24187, because no lot scan or container assignment happens in this flow. The fields render when the API has them. Lot capture by scan is unchanged and out of this bolt's scope.

### Dependencies Added

None.

### Developer Notes

- `scales.keepDevicesAlive()` is called only by `server.ts`; tests that drive the pumps themselves are unaffected.
- The completion summary's elapsed time is now shown as "N min N s" (the prototype's form); one UI test asserts the raw seconds and is updated in the Test stage.
